import { track } from '@/services/analytics';

import { chatCompletion, type ChatRequest, type ChatResult } from './client';
import { getApiKey, getModel } from './config';
import { toAiError } from './errors';

/**
 * The production chat entry point + request-lifecycle analytics (CLAUDE.md:
 * exceptional tracking): every AI request emits sent/succeeded/failed with
 * its feature tag, so the queue is debuggable from analytics_events alone.
 * Props carry codes and counts only — never text, never the key.
 */
export type AiFeature =
  'journal-feedback' | 'enrichment' | 'explain' | 'key-test' | 'assessment' | 'import-annotate';

export async function runChat(feature: AiFeature, req: ChatRequest): Promise<ChatResult> {
  track('ai_request_sent', { feature });
  const startedAt = Date.now();
  try {
    const result = await chatCompletion(req, { getApiKey, getModel });
    track('ai_request_succeeded', { feature, ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    const aiErr = toAiError(err);
    track('ai_request_failed', { feature, code: aiErr.code, ms: Date.now() - startedAt });
    throw aiErr;
  }
}
