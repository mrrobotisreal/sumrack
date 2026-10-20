import { z } from 'zod';
import {
  AttemptSchema,
  assessDictation,
  EMPTY_ASSISTANCE,
  StageSchema,
  type ListeningAttempt,
} from './attempt';
import { LISTENING_MODE, type ListeningSegment } from './catalog';

export const DraftSchema = z.object({
  id: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  segmentId: z.string(),
  stage: StageSchema,
  dictationText: z.string().max(4000),
  retellingText: z.string().max(4000),
  attempt: AttemptSchema,
});
export type LabDraft = z.infer<typeof DraftSchema>;
export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
const keyFor = (segmentId: string) => `@sumrak/listening-lab-draft-v1/${segmentId}`;

/** A bounded draft per bundled segment. Local-only, removed after the immutable final row is saved. */
export function createDraftStore(storage: DraftStorage) {
  let pending: Promise<void> = Promise.resolve();
  return {
    async read(segmentId: string): Promise<LabDraft | null> {
      await pending;
      const raw = await storage.getItem(keyFor(segmentId));
      if (!raw) return null;
      const result = DraftSchema.safeParse(JSON.parse(raw));
      if (
        !result.success ||
        result.data.segmentId !== segmentId ||
        result.data.attempt.segmentId !== segmentId
      )
        throw new Error('The saved draft cannot be read. It has been kept for recovery.');
      return result.data;
    },
    write(draft: LabDraft): Promise<void> {
      const validated = DraftSchema.parse(draft);
      const next = pending.then(() =>
        storage.setItem(keyFor(draft.segmentId), JSON.stringify(validated)),
      );
      pending = next.catch(() => {});
      return next;
    },
    remove(segmentId: string): Promise<void> {
      const next = pending.then(() => storage.removeItem(keyFor(segmentId)));
      pending = next.catch(() => {});
      return next;
    },
  };
}
export function newDraft(
  segment: ListeningSegment,
  id: string,
  startedAt: number,
  priorExposures: number,
  exposureKnown: boolean,
): LabDraft {
  const { packId, packVersion, storyId, sentenceId, trackId } = segment.source;
  const attempt: ListeningAttempt = {
    version: 1,
    catalogVersion: 1,
    segmentId: segment.id,
    source: { packId, packVersion, storyId, sentenceId, trackId },
    yoPolicy: segment.yoPolicy,
    priorExposures,
    exposureKnown,
    visited: ['listen'],
    assistance: { ...EMPTY_ASSISTANCE },
    meaning: null,
    dictation: null,
    retelling: '',
    selfReview: 'not-reviewed',
    recording: null,
    grader: 'local-answer-key-and-word-alignment-v1',
  };
  return {
    id,
    startedAt,
    segmentId: segment.id,
    stage: 'listen',
    dictationText: '',
    retellingText: '',
    attempt,
  };
}

/** Build once before any I/O so an uncertain save can retry exactly the same immutable row. */
export function completeDraft(current: LabDraft, segment: ListeningSegment, endedAt: number) {
  const detail = AttemptSchema.parse({
    ...current.attempt,
    retelling: current.retellingText,
    dictation:
      current.attempt.dictation ??
      (current.dictationText.trim()
        ? assessDictation(
            segment,
            current.dictationText,
            current.attempt.assistance,
            current.attempt.priorExposures,
            current.attempt.exposureKnown,
          )
        : null),
  });
  const assessed = [detail.meaning, detail.dictation].filter((a) => a !== null);
  return {
    id: current.id,
    mode: LISTENING_MODE,
    startedAt: current.startedAt,
    endedAt: Math.max(endedAt, current.startedAt),
    itemCount: assessed.length,
    correctCount: assessed.filter((a) => a.correct).length,
    detail,
  };
}
