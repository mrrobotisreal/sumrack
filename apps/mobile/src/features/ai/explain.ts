import { buildExplainMessages, type ExplainTarget } from './prompts/explain';
import { runChat } from './runner';
import { AiError } from './errors';
import { ExplainResponseSchema } from './schemas';

/**
 * "Explain this" (ticket feature 3). Results are TRANSIENT — session-level
 * in-memory cache only, nothing persisted (recorded ticket decision: an
 * explanation is a lookup, not a document; re-asking is cheap and the
 * cache makes reopening the same target instant).
 */

const cache = new Map<string, string>();

export function cacheKey(target: ExplainTarget): string {
  if (target.kind === 'sentence') return `s:${target.ru}`;
  return `c:${target.headword}${target.leech ? ':leech' : ''}`;
}

export async function explain(target: ExplainTarget): Promise<string> {
  const key = cacheKey(target);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = await runChat('explain', {
    messages: buildExplainMessages(target),
    maxTokens: 1024,
    temperature: 0.4,
  });
  const parsed = ExplainResponseSchema.safeParse(result.content.trim());
  if (!parsed.success) throw new AiError('invalid-response', 'empty explanation');
  cache.set(key, parsed.data);
  return parsed.data;
}

export type { ExplainTarget };
