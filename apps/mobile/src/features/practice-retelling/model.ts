import { z } from 'zod';

export const PRACTICE_MODE = 'practice-retelling';
export const PRACTICE_QUOTA_BYTES = 128 * 1024 * 1024;
export const RUBRIC_VERSION = 'story-comprehension-v1';
const id = z.string().min(1).max(160);
const text = z.string().max(12000);
const base = { v: z.literal(1), id, at: z.number().int().nonnegative() };
export const PracticeContextSchema = z.object({
  kind: z.enum(['case-file', 'listening-lab']),
  contextId: id,
  attemptId: id,
  stage: z.string().min(1).max(40),
  helped: z.boolean(),
  repeated: z.boolean(),
});
export type PracticeContext = z.infer<typeof PracticeContextSchema>;
export const KeptMediaSchema = z.object({
  ...base,
  kind: z.literal('media-kept'),
  mediaId: z.string().regex(/^practice-[a-z0-9-]{4,70}$/),
  context: PracticeContextSchema,
  file: z.literal('original.wav'),
  bytes: z
    .number()
    .int()
    .positive()
    .max(4 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationMs: z.number().positive().max(65000),
});
export type KeptMedia = z.infer<typeof KeptMediaSchema>;
export const TranscriptSchema = z.object({
  ...base,
  kind: z.literal('transcript'),
  mediaId: id,
  text,
  source: z.enum(['asr-original', 'user-confirmed']),
  originalId: id.nullable(),
  model: z.string().min(1),
});
export type PracticeTranscript = z.infer<typeof TranscriptSchema>;
export const FeedbackRequestSchema = z.object({
  ...base,
  kind: z.literal('feedback-request'),
  requestId: id,
  context: PracticeContextSchema,
  caseRevision: z.number().int().positive(),
  packId: id,
  packVersion: z.number().int().positive(),
  ownerDeviceId: id,
  input: text.min(1),
  inputKind: z.enum(['typed', 'confirmed-asr']),
  transcriptId: id.nullable(),
  model: z.string().min(1),
  rubric: z.literal(RUBRIC_VERSION),
  supersedes: id.nullable(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
const Observation = z.object({
  comment: z.string().min(1).max(1200),
  evidenceIds: z.array(id).max(10),
});
export const RetellingFeedbackSchema = z.strictObject({
  facts: z.array(Observation).max(8),
  links: z.array(Observation).max(8),
  ownWords: z.string().min(1).max(1500),
  grammar: z
    .array(z.object({ original: text.min(1), suggestion: text, explanation: z.string().max(1000) }))
    .max(8),
  nextStep: z.string().min(1).max(1500),
  assessmentBasis: z.literal('text-only'),
});
export type RetellingFeedback = z.infer<typeof RetellingFeedbackSchema>;
export const PracticeEventSchema = z.discriminatedUnion('kind', [
  KeptMediaSchema,
  z.object({ ...base, kind: z.literal('media-deleted'), mediaId: id }),
  z.object({
    ...base,
    kind: z.literal('media-bundle'),
    mediaId: id,
    state: z.enum(['pending', 'failed', 'uploaded', 'restored']),
  }),
  TranscriptSchema,
  FeedbackRequestSchema,
  z.object({ ...base, kind: z.literal('feedback-started'), requestId: id }),
  z.object({ ...base, kind: z.literal('feedback-cancelled'), requestId: id }),
  z.object({
    ...base,
    kind: z.literal('feedback-error'),
    requestId: id,
    code: z.string().max(60),
    deliveryUnknown: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal('feedback-result'),
    requestId: id,
    model: z.string().min(1),
    rubric: z.literal(RUBRIC_VERSION),
    feedback: RetellingFeedbackSchema,
  }),
]);
export type PracticeEvent = z.infer<typeof PracticeEventSchema>;
export type FeedbackResult = Extract<PracticeEvent, { kind: 'feedback-result' }>;
export function parsePracticeEvents(rows: readonly { detail: unknown }[]): PracticeEvent[] {
  return rows.flatMap((row) => {
    const parsed = PracticeEventSchema.safeParse(row.detail);
    return parsed.success ? [parsed.data] : [];
  });
}
export function keptMedia(events: readonly PracticeEvent[]): KeptMedia[] {
  const deleted = new Set(events.filter((e) => e.kind === 'media-deleted').map((e) => e.mediaId));
  return events
    .filter((e): e is KeptMedia => e.kind === 'media-kept' && !deleted.has(e.mediaId))
    .sort((a, b) => b.at - a.at);
}
export function mediaBundleState(events: readonly PracticeEvent[], mediaId: string) {
  const receipts = events.filter(
    (e): e is Extract<PracticeEvent, { kind: 'media-bundle' }> =>
      e.kind === 'media-bundle' && e.mediaId === mediaId,
  );
  if (receipts.some((e) => e.state === 'uploaded' || e.state === 'restored'))
    return 'uploaded' as const;
  return receipts.sort((a, b) => b.at - a.at)[0]?.state ?? null;
}
export type FeedbackStatus = 'queued' | 'sending-or-interrupted' | 'cancelled' | 'failed' | 'done';
export function feedbackStatus(
  events: readonly PracticeEvent[],
  requestId: string,
): FeedbackStatus {
  const own = events.filter((e) => 'requestId' in e && e.requestId === requestId);
  if (own.some((e) => e.kind === 'feedback-cancelled')) return 'cancelled';
  if (own.some((e) => e.kind === 'feedback-result')) return 'done';
  if (own.some((e) => e.kind === 'feedback-error')) return 'failed';
  if (own.some((e) => e.kind === 'feedback-started')) return 'sending-or-interrupted';
  return 'queued';
}
export function assertConfirmedTranscript(
  events: readonly PracticeEvent[],
  transcriptId: string,
): PracticeTranscript {
  const transcript = events.find(
    (e): e is PracticeTranscript => e.kind === 'transcript' && e.id === transcriptId,
  );
  if (
    !transcript ||
    transcript.source !== 'user-confirmed' ||
    !transcript.originalId ||
    !events.some(
      (e) =>
        e.kind === 'transcript' &&
        e.id === transcript.originalId &&
        e.mediaId === transcript.mediaId &&
        e.source === 'asr-original',
    )
  )
    throw new Error('Review and confirm the transcript before requesting text feedback.');
  return transcript;
}

export function confirmedTranscript(
  original: PracticeTranscript,
  corrected: string,
  id: string,
  at: number,
): PracticeTranscript {
  if (original.source !== 'asr-original' || !corrected.trim())
    throw new Error('Confirm an original recognition result with nonempty text.');
  return TranscriptSchema.parse({
    ...original,
    id,
    at,
    text: corrected,
    source: 'user-confirmed',
    originalId: original.id,
    model: 'user-confirmed',
  });
}
