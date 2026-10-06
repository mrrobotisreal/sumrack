import {
  ExamSubtestKindSchema,
  type Exam,
  type ExamItem,
  type ExamPart,
  type ExamSubtest,
} from '@sumrak/schema';
import { z } from 'zod';

/**
 * M18 «ТРКИ» — the JSON-column contracts of the three exam user tables
 * (T68, TORFL_EXAM_PREP §4.2). Pure (no DB/React imports) so the repo, the
 * engine (T71) and tests share one definition. Every reader goes through
 * these schemas: the exams repo parses on read and an unreadable value
 * resolves to `null` (one `app_error` per row) — never a crash.
 *
 * Tolerance rule: attempts outlive app versions, so the READ schemas strip
 * unknown keys (`z.object`) instead of refusing them; the engine state is
 * `z.looseObject` so a field T71+ adds survives a round trip through an
 * older reader.
 */

const int = z.number().int();
const nonNegInt = int.min(0);

export const EXAM_SCOPES = ['full', 'subtest', 'drill'] as const;
export const ExamScopeSchema = z.enum(EXAM_SCOPES);
export type ExamScope = z.infer<typeof ExamScopeSchema>;

export const ExamModeSchema = z.enum(['mock', 'drill']);
export type ExamMode = z.infer<typeof ExamModeSchema>;

export const ExamAttemptStatusSchema = z.enum(['active', 'finished', 'abandoned']);
export type ExamAttemptStatus = z.infer<typeof ExamAttemptStatusSchema>;

/** The SPbU verdict (§6.3); null on non-full scopes. */
export const ExamVerdictSchema = z.enum(['pass', 'pass-borderline', 'fail']);
export type ExamVerdict = z.infer<typeof ExamVerdictSchema>;

export const EXAM_GRADING_STATUSES = [
  'scored',
  'provisional',
  'pending-ai',
  'ai-failed',
  'self-graded',
] as const;
export const ExamGradingStatusSchema = z.enum(EXAM_GRADING_STATUSES);
export type ExamGradingStatus = z.infer<typeof ExamGradingStatusSchema>;

// --- exam_attempts.subtestIds ------------------------------------------------

export const ExamSubtestIdsSchema = z.array(z.string().min(1)).min(1);

// --- exam_attempts.stateJson (§8.1; the engine owns the semantics) -------------

/** One subtest's progress inside an attempt. `deadlineAt` is a WALL-CLOCK epoch (survives kills). */
export const ExamSubtestCursorSchema = z.looseObject({
  id: z.string().min(1),
  kind: ExamSubtestKindSchema,
  status: z.enum(['pending', 'intro', 'running', 'submitted']),
  deadlineAt: int.optional(),
  partIdx: nonNegInt,
  itemIdx: nonNegInt,
});
export type ExamSubtestCursor = z.infer<typeof ExamSubtestCursorSchema>;

export const ExamSpeakingStateSchema = z.looseObject({
  /** 1 | 2 | 3 — the official task number. */
  task: int.min(1).max(3),
  phase: z.enum(['prompt', 'listening', 'recording', 'prep', 'answer']),
  phaseDeadlineAt: int.optional(),
});

/**
 * Engine state for resume (`exam_attempts.stateJson`). The repo validates
 * the shape and writes whatever it is given; throttling is the engine's job.
 */
export const ExamAttemptStateSchema = z.looseObject({
  v: z.literal(1),
  subtests: z.array(ExamSubtestCursorSchema),
  /** Index into `subtests` of the subtest on screen. */
  current: nonNegInt,
  /** Engine phase slug (T71 owns the set: 'intro', 'running', 'break', …). */
  phase: z.string().min(1),
  /** Listening play counters keyed by item/audio key (mock: max `audioPlays`). */
  playCounts: z.record(z.string(), nonNegInt).default({}),
  /** Matrix flags ⚑ (item ids). */
  flagged: z.array(z.string()).default([]),
  speaking: ExamSpeakingStateSchema.nullable().optional(),
});
export type ExamAttemptState = z.infer<typeof ExamAttemptStateSchema>;

/** A fresh state for an attempt over `subtests` (all pending, cursor at 0/0). */
export function initialAttemptState(
  subtests: readonly Pick<ExamSubtest, 'id' | 'kind'>[],
): ExamAttemptState {
  return {
    v: 1,
    subtests: subtests.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: 'pending' as const,
      partIdx: 0,
      itemIdx: 0,
    })),
    current: 0,
    phase: 'intro',
    playCounts: {},
    flagged: [],
    speaking: null,
  };
}

// --- exam_attempts.resultsJson -------------------------------------------------

export const ExamSubtestResultSchema = z.object({
  points: z.number().min(0),
  maxPoints: z.number().positive(),
  /** Σ points / maxPoints × 100, one decimal (§6.1). */
  pct: z.number().min(0).max(100),
  /** Writing/speaking scored offline only → the verdict is provisional too. */
  provisional: z.boolean(),
  gradedBy: z.enum(['offline', 'ai', 'self']),
});
export type ExamSubtestResult = z.infer<typeof ExamSubtestResultSchema>;

/** `{ [subtestId]: ExamSubtestResult }` */
export const ExamResultsSchema = z.record(z.string().min(1), ExamSubtestResultSchema);
export type ExamResults = z.infer<typeof ExamResultsSchema>;

// --- exam_responses.answerJson (discriminated by ITEM kind) -------------------

export const ChoiceAnswerSchema = z.object({
  kind: z.literal('choice'),
  /** Chosen option index; null = left blank (auto-submitted / cleared). */
  index: nonNegInt.nullable(),
});
export const TypedAnswerSchema = z.object({ kind: z.literal('typed'), text: z.string() });
export const WritingAnswerSchema = z.object({ kind: z.literal('writing'), text: z.string() });
/** T73: one ASR word with its stamps (ms from the recording start) — the sentence estimate's input. */
export const SpeakingWordStampSchema = z.object({ w: z.string(), s: nonNegInt, e: nonNegInt });
export type SpeakingWordStamp = z.infer<typeof SpeakingWordStampSchema>;

export const SpeakingAnswerSchema = z.object({
  kind: z.enum(['speaking-reply', 'speaking-situation', 'speaking-monologue']),
  transcript: z.string(),
  /** The Whisper assist re-decode, when installed (§6.2: keep the higher judge score). */
  assistTranscript: z.string().optional(),
  /** T73: the primary (Zipformer) transcript's word stamps — lets the pure grader + debrief run from the row. */
  words: z.array(SpeakingWordStampSchema).optional(),
  /** Relative to the exam recordings root; null once pruned (§8.5). */
  recordingPath: z.string().nullable(),
  durationMs: nonNegInt,
});
export type SpeakingAnswer = z.infer<typeof SpeakingAnswerSchema>;

export const ExamAnswerSchema = z.discriminatedUnion('kind', [
  ChoiceAnswerSchema,
  TypedAnswerSchema,
  WritingAnswerSchema,
  SpeakingAnswerSchema,
]);
export type ExamAnswer = z.infer<typeof ExamAnswerSchema>;

/** True when the answer actually says something (a blank choice / empty text is unanswered). */
export function isAnswered(answer: ExamAnswer): boolean {
  switch (answer.kind) {
    case 'choice':
      return answer.index !== null;
    case 'typed':
    case 'writing':
      return answer.text.trim().length > 0;
    default:
      return answer.transcript.trim().length > 0;
  }
}

// --- exam_responses.gradingJson (§6.2) -----------------------------------------

export const ExamCriterionSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(0),
  max: z.number().positive(),
  comment: z.string().optional(),
});
export type ExamCriterion = z.infer<typeof ExamCriterionSchema>;

/**
 * Offline breakdown + AI rubric payload + self-check (§6.2). Each part is
 * optional: an objective item usually has none; a writing response carries
 * `offline` first, gains `ai` when graded, or `self` when never online.
 */
export const ExamGradingSchema = z.object({
  v: z.literal(1),
  offline: z
    .object({
      criteria: z.array(ExamCriterionSchema),
      /** Judge verdicts / coverage details the debrief shows (shape owned by T72/T73). */
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  ai: z
    .object({
      criteria: z.array(ExamCriterionSchema),
      corrected: z.string().optional(),
      changes: z
        .array(z.object({ before: z.string(), after: z.string(), explanation: z.string() }))
        .optional(),
      tips: z.array(z.string()),
      provider: z.string().optional(),
      model: z.string().optional(),
      quality: z.string().optional(),
      effort: z.string().optional(),
      gradedAt: int.optional(),
      costUsd: z.number().optional(),
    })
    .optional(),
  self: z.object({ criteria: z.array(ExamCriterionSchema) }).optional(),
  /** The last AI failure (T72 queue: retries 2 s / 8 s, then `ai-failed`). */
  error: z.object({ code: z.string(), attempts: nonNegInt, at: int.optional() }).optional(),
});
export type ExamGrading = z.infer<typeof ExamGradingSchema>;

// --- exam_item_cards.fsrsJson ----------------------------------------------------

/** The ts-fsrs Card with dates as epoch ms (JSON-safe). `state`: 0 New · 1 Learning · 2 Review · 3 Relearning. */
export const ExamFsrsCardSchema = z.object({
  due: int,
  stability: z.number().min(0),
  difficulty: z.number().min(0),
  elapsed_days: z.number().min(0),
  scheduled_days: z.number().min(0),
  learning_steps: nonNegInt,
  reps: nonNegInt,
  lapses: nonNegInt,
  state: int.min(0).max(3),
  last_review: int.nullable(),
});
export type ExamFsrsCard = z.infer<typeof ExamFsrsCardSchema>;

/** The deck key of an exam item (§4.2): `${packId}:${examId}:${itemId}`. */
export function examItemKey(packId: string, examId: string, itemId: string): string {
  return `${packId}:${examId}:${itemId}`;
}

// --- exam navigation helpers (pure; §12 pack-update tolerance) ------------------

export interface LocatedExamItem {
  subtest: ExamSubtest;
  part: ExamPart;
  item: ExamItem;
  partIdx: number;
  itemIdx: number;
}

/**
 * Find an item by id in the CURRENT exam. `null` when a pack update removed
 * it — callers render «(задание удалено в новой версии)» (§12); never throw.
 */
export function findExamItem(
  exam: Exam,
  itemId: string,
  subtestId?: string,
): LocatedExamItem | null {
  for (const subtest of exam.subtests) {
    if (subtestId !== undefined && subtest.id !== subtestId) continue;
    for (const [partIdx, part] of subtest.parts.entries()) {
      for (const [itemIdx, item] of part.items.entries()) {
        if (item.id === itemId) return { subtest, part, item, partIdx, itemIdx };
      }
    }
  }
  return null;
}

/** Item count of a subtest (all parts). */
export function subtestItemCount(subtest: Pick<ExamSubtest, 'parts'>): number {
  return subtest.parts.reduce((n, p) => n + p.items.length, 0);
}
