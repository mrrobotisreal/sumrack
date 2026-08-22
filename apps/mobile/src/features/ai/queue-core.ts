import type { ChatRequest, ChatResult } from './client';
import { AiError, friendlyAiMessage, isRetriable, toAiError } from './errors';
import { buildJournalFeedbackMessages } from './prompts/journal-feedback';
import { extractJsonObject, JournalFeedbackSchema, type StoredFeedback } from './schemas';

/**
 * Pure queue state machine for journal feedback (T16 ticket item 2) — no
 * DB, network, or store imports, so vitest exercises the exact production
 * logic against fakes (the repo test convention: pure core + thin wiring,
 * same split as sync-core/sync-service). Wiring lives in
 * journal-feedback.ts.
 */

export type FeedbackPhase = 'queued' | 'sending' | 'error';

export interface EntryFeedbackState {
  phase: FeedbackPhase;
  /** Plain-language error for phase 'error' (friendlyAiMessage — key-free). */
  message?: string;
}

/** Transient-failure retries within one pump pass (then wait for next trigger). */
export const RETRY_DELAYS_MS = [2_000, 8_000];

export interface FeedbackQueueDeps {
  listQueued: () => Promise<{ id: string; ru: string }[]>;
  saveDone: (entryId: string, storedJson: string) => Promise<void>;
  chat: (req: ChatRequest) => Promise<ChatResult>;
  isOnline: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  onPhase: (entryId: string, state: EntryFeedbackState | null) => void;
  now: () => number;
  retryDelaysMs?: number[];
}

/** Parse the model's completion into the persisted feedback envelope. */
export function parseFeedbackCompletion(
  content: string,
  sourceRu: string,
  model: string,
  now: number,
): StoredFeedback {
  const json = extractJsonObject(content);
  const parsed = JournalFeedbackSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiError('invalid-response', 'feedback did not match the expected shape');
  }
  return { v: 1, ...parsed.data, sourceRu, model, createdAt: now };
}

/**
 * Drain every queued entry. The durable queue is the journal rows
 * themselves ('queued' = pending); failures keep the row queued — never
 * silently dropped — and surface a per-entry error phase. Returns how
 * many entries reached 'done'.
 */
export async function processFeedbackQueue(deps: FeedbackQueueDeps): Promise<number> {
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const queued = await deps.listQueued();
  if (queued.length === 0) return 0;

  let doneCount = 0;
  for (const entry of queued) {
    if (!(await deps.isOnline())) {
      // Offline is a quiet, normal state (§3.1): row stays 'queued', the
      // connectivity listener re-pumps. Reflect it so the UI can say so.
      deps.onPhase(entry.id, { phase: 'queued' });
      break;
    }
    deps.onPhase(entry.id, { phase: 'sending' });

    let lastError: AiError | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const result = await deps.chat({
          messages: buildJournalFeedbackMessages(entry.ru),
          maxTokens: 4096,
        });
        const stored = parseFeedbackCompletion(result.content, entry.ru, result.model, deps.now());
        await deps.saveDone(entry.id, JSON.stringify(stored));
        deps.onPhase(entry.id, null);
        doneCount++;
        lastError = null;
        break;
      } catch (err) {
        lastError = toAiError(err);
        if (!isRetriable(lastError) || attempt === delays.length) break;
        await deps.sleep(delays[attempt]!);
      }
    }
    if (lastError) {
      deps.onPhase(entry.id, { phase: 'error', message: friendlyAiMessage(lastError) });
      // A key problem will fail every remaining entry identically — stop
      // the pass rather than burning through the queue.
      if (lastError.code === 'no-key' || lastError.code === 'http-auth') break;
    }
  }
  return doneCount;
}
