import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { repos } from '@/db';
import { ensureDeviceId } from '@/features/account/store';
import { getApiKey, getModel } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import { runChat } from '@/features/ai/runner';
import { findCaseFile } from '@/features/story-case-files/catalog';
import { caseAvailability, type CaseAttempt } from '@/features/story-case-files/model';
import { track } from '@/services/analytics';
import { createRetellingQueue } from './feedback-core';
import {
  assertConfirmedTranscript,
  feedbackStatus,
  PracticeEventSchema,
  RUBRIC_VERSION,
  type FeedbackRequest,
} from './model';
import { practiceStore } from './runtime-store';
import { refreshPractice } from './media-service';
const cacheKey = (id: string) => `sumrak:retelling-feedback-result:v1:${id}`;
const queue = createRetellingQueue({
  store: practiceStore,
  ownerDeviceId: ensureDeviceId,
  isOnline,
  configured: async () => !!(await getApiKey()),
  chat: (messages, model, signal) =>
    runChat('retelling-feedback', { messages, model, signal, maxTokens: 3200 }),
  async readCached(id) {
    const raw = await AsyncStorage.getItem(cacheKey(id));
    if (!raw) return null;
    try {
      const event = PracticeEventSchema.parse(JSON.parse(raw));
      return event.kind === 'feedback-result' && event.requestId === id ? event : null;
    } catch {
      return null;
    }
  },
  cache: (result) => AsyncStorage.setItem(cacheKey(result.requestId), JSON.stringify(result)),
  clearCached: (id) => AsyncStorage.removeItem(cacheKey(id)),
  now: Date.now,
  changed: refreshPractice,
});
export function pumpRetellingFeedback() {
  return queue.pump();
}
export async function cancelRetellingFeedback(id: string) {
  await queue.cancel(id);
  track('retelling_feedback_action', { action: 'cancelled', requestId: id });
}
const requesting = new Map<string, Promise<FeedbackRequest>>();
export function requestRetellingFeedback(
  attempt: CaseAttempt,
  options: { transcriptId?: string; regrade?: boolean } = {},
) {
  const key = `${attempt.id}:${options.transcriptId ?? 'typed'}:${!!options.regrade}`;
  const prior = requesting.get(key);
  if (prior) return prior;
  const pending = requestOnce(attempt, options).finally(() => {
    requesting.delete(key);
  });
  requesting.set(key, pending);
  return pending;
}
async function requestOnce(
  attempt: CaseAttempt,
  options: { transcriptId?: string; regrade?: boolean },
): Promise<FeedbackRequest> {
  const file = findCaseFile(attempt.caseId);
  if (!file || file.revision !== attempt.revision)
    throw new Error(
      'This case companion has changed. Complete a fresh attempt before requesting feedback.',
    );
  const [source, progress] = await Promise.all([
    repos.content.getStoryDetail(file.packId, file.storyId),
    repos.reading.getProgress(file.packId, file.storyId),
  ]);
  if (caseAvailability(file, source, progress) !== 'ready')
    throw new Error(
      'Restore the matching source pack and reading progress before requesting feedback.',
    );
  const events = await practiceStore.list();
  const transcript = options.transcriptId
    ? assertConfirmedTranscript(events, options.transcriptId)
    : null;
  if (transcript) {
    const recording = events.find(
      (e) => e.kind === 'media-kept' && e.mediaId === transcript.mediaId,
    );
    if (
      !recording ||
      recording.kind !== 'media-kept' ||
      recording.context.attemptId !== attempt.id ||
      events.some((e) => e.kind === 'media-deleted' && e.mediaId === transcript.mediaId)
    )
      throw new Error('Select a confirmed transcript belonging to this attempt.');
  }
  const prior = events
    .filter(
      (e): e is FeedbackRequest =>
        e.kind === 'feedback-request' &&
        e.context.attemptId === attempt.id &&
        e.transcriptId === (transcript?.id ?? null),
    )
    .sort((a, b) => b.at - a.at);
  const existing = prior[0];
  if (existing && !options.regrade) return existing;
  if (
    existing &&
    ['queued', 'sending-or-interrupted'].includes(feedbackStatus(events, existing.requestId))
  )
    throw new Error(
      'Cancel the previous request before creating another. An already sent request may have been charged.',
    );
  const requestId = randomUUID();
  const request: FeedbackRequest = {
    v: 1,
    id: requestId,
    requestId,
    kind: 'feedback-request',
    at: Date.now(),
    context: {
      kind: 'case-file',
      contextId: file.id,
      attemptId: attempt.id,
      stage: attempt.stage,
      helped: attempt.helped,
      repeated: attempt.exposure === 'repeated',
    },
    caseRevision: file.revision,
    packId: file.packId,
    packVersion: file.packVersion,
    ownerDeviceId: await ensureDeviceId(),
    input: transcript?.text ?? attempt.retelling,
    inputKind: transcript ? 'confirmed-asr' : 'typed',
    transcriptId: transcript?.id ?? null,
    model: await getModel(),
    rubric: RUBRIC_VERSION,
    supersedes: existing?.requestId ?? null,
  };
  await practiceStore.append(request);
  track('retelling_feedback_action', {
    action: 'requested',
    requestId,
    inputKind: request.inputKind,
    regrade: !!existing,
  });
  refreshPractice();
  void queue.pump().catch(() => refreshPractice());
  return request;
}
