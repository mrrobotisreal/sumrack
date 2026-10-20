import { z } from 'zod';
import { YoPolicySchema, type ListeningSegment } from './catalog';
import { compareDictation } from './compare';

export const StageSchema = z.enum(['listen', 'meaning', 'dictation', 'reveal', 'shadow', 'retell']);
export type Stage = z.infer<typeof StageSchema>;
export const AssistanceSchema = z.object({
  plays: z.number().int().nonnegative(),
  slowPlays: z.number().int().nonnegative(),
  help: z.number().int().nonnegative(),
  transcriptSeen: z.boolean(),
});
export type Assistance = z.infer<typeof AssistanceSchema>;
export const EMPTY_ASSISTANCE: Assistance = {
  plays: 0,
  slowPlays: 0,
  help: 0,
  transcriptSeen: false,
};
const AssessmentSchema = z.object({
  correct: z.boolean(),
  assistance: AssistanceSchema,
  firstListen: z.boolean(),
  firstLabListen: z.boolean(),
});
export const AttemptSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.literal(1),
  segmentId: z.string(),
  source: z.object({
    packId: z.string(),
    packVersion: z.number().int(),
    storyId: z.string(),
    sentenceId: z.string(),
    trackId: z.string(),
  }),
  yoPolicy: YoPolicySchema,
  priorExposures: z.number().int().nonnegative(),
  exposureKnown: z.boolean(),
  visited: z.array(StageSchema),
  assistance: AssistanceSchema,
  meaning: AssessmentSchema.extend({ response: z.number().int().min(0).max(2) }).nullable(),
  dictation: AssessmentSchema.extend({ response: z.string().max(4000) }).nullable(),
  retelling: z.string().max(4000),
  selfReview: z.enum(['not-reviewed', 'needs-practice', 'comfortable']),
  recording: z
    .object({ durationMs: z.number().nonnegative(), retention: z.literal('temporary-cache') })
    .nullable(),
  grader: z.literal('local-answer-key-and-word-alignment-v1'),
});
export type ListeningAttempt = z.infer<typeof AttemptSchema>;

export function firstListen(
  assistance: Assistance,
  priorExposures: number,
  exposureKnown: boolean,
): boolean {
  return (
    exposureKnown &&
    priorExposures === 0 &&
    assistance.plays === 1 &&
    assistance.slowPlays === 0 &&
    assistance.help === 0 &&
    !assistance.transcriptSeen
  );
}
export function assessMeaning(
  segment: ListeningSegment,
  response: number,
  assistance: Assistance,
  priorExposures: number,
  exposureKnown: boolean,
) {
  return {
    response,
    correct: response === segment.meaning.correctIndex,
    assistance: { ...assistance },
    firstListen: firstListen(assistance, priorExposures, exposureKnown),
    firstLabListen: firstListen(assistance, priorExposures, true),
  };
}
export function assessDictation(
  segment: ListeningSegment,
  response: string,
  assistance: Assistance,
  priorExposures: number,
  exposureKnown: boolean,
) {
  return {
    response,
    correct: compareDictation(
      segment.transcript,
      response,
      segment.yoPolicy,
      segment.endingPairs,
    ).every((w) => w.kind === 'correct'),
    assistance: { ...assistance },
    firstListen: firstListen(assistance, priorExposures, exposureKnown),
    firstLabListen: firstListen(assistance, priorExposures, true),
  };
}
export function exposureCount(rows: readonly { detail: unknown }[], segmentId: string): number {
  return rows.filter((r) => {
    const d = AttemptSchema.safeParse(r.detail);
    return d.success && d.data.segmentId === segmentId;
  }).length;
}
