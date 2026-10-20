import { z } from 'zod';

export const CASE_FILE_MODE = 'story-case-file';
const id = z.string().min(1);
export const QuestionSchema = z
  .object({
    id,
    kind: z.enum(['fact', 'reference', 'sequence', 'inference', 'evidence']),
    prompt: z.string().min(1),
    options: z.array(z.object({ id, text: z.string().min(1) })).min(2),
    accepted: z.array(id).min(1),
    explanation: z.string().min(1),
    sourceIds: z.array(id).min(1),
  })
  .superRefine((q, ctx) => {
    if (
      new Set(q.options.map((o) => o.id)).size !== q.options.length ||
      q.accepted.some((a) => !q.options.some((o) => o.id === a))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Question option IDs must be unique and accepted answers must exist',
      });
    }
  });
const activity = {
  questions: z.array(QuestionSchema).min(1),
  retellPrompt: z.string().min(1),
  checklist: z.array(z.string().min(1)).min(1),
};
export const CaseFileSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  revision: z.number().int().positive(),
  title: z.string().min(1),
  packId: id,
  packVersion: z.number().int().positive(),
  storyId: id,
  boundarySentenceId: id,
  source: z.array(z.object({ id, ru: z.string().min(1) })).min(1),
  ...activity,
  transfer: z.object({
    title: z.string().min(1),
    sentences: z.array(z.object({ id, ru: z.string().min(1) })).min(1),
    ...activity,
  }),
});
export type CaseFile = z.infer<typeof CaseFileSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type CaseStage = 'story' | 'transfer';

export const CaseDraftSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  caseId: id,
  revision: z.number().int().positive(),
  stage: z.enum(['story', 'transfer']),
  startedAt: z.number().int().nonnegative(),
  answers: z.record(z.string(), z.string()),
  retelling: z.string().max(12000),
  checklist: z.array(z.number().int().nonnegative()),
  helped: z.boolean(),
});
export type CaseDraft = z.infer<typeof CaseDraftSchema>;
export const CaseAttemptSchema = CaseDraftSchema.extend({
  endedAt: z.number().int().nonnegative(),
  packId: id,
  packVersion: z.number().int().positive(),
  storyId: id,
  exposure: z.enum(['first', 'repeated']),
  grader: z.literal('authored-key-and-self-review-v1'),
  correctCount: z.number().int().nonnegative(),
  itemCount: z.number().int().positive(),
  results: z.array(z.object({ questionId: id, answer: id, correct: z.boolean() })),
});
export type CaseAttempt = z.infer<typeof CaseAttemptSchema>;

export interface CaseSource {
  pack: { id: string; version: number };
  story: { id: string };
  sentences: readonly { id: string; ru: string; orderIdx: number }[];
}
export type CaseAvailability = 'ready' | 'missing' | 'stale' | 'unread';

/** The same fail-closed gate is used by the reader and direct routes. */
export function caseAvailability(
  file: CaseFile,
  source: CaseSource | null | undefined,
  progress: { finishedAt: number | null } | null | undefined,
): CaseAvailability {
  if (!source) return 'missing';
  if (validateSource(file, source).length) return 'stale';
  return progress?.finishedAt != null ? 'ready' : 'unread';
}

/** Checks both stable IDs and the exact authored Russian, not just pack version. */
export function validateSource(file: CaseFile, source: CaseSource): string[] {
  const errors: string[] = [];
  if (
    source.pack.id !== file.packId ||
    source.pack.version !== file.packVersion ||
    source.story.id !== file.storyId
  )
    errors.push('pack/story/version mismatch');
  const byId = new Map(source.sentences.map((s) => [s.id, s]));
  const boundary = byId.get(file.boundarySentenceId);
  if (!boundary || boundary.orderIdx !== source.sentences.length - 1)
    errors.push('boundary must be the end of this part');
  if (byId.size !== source.sentences.length) errors.push('duplicate source IDs');
  const expected = new Map(file.source.map((s) => [s.id, s.ru]));
  for (const [sid, ru] of expected) {
    const sentence = byId.get(sid);
    if (!sentence || sentence.ru !== ru || !boundary || sentence.orderIdx > boundary.orderIdx)
      errors.push(`invalid source ${sid}`);
  }
  const transferIds = new Set(file.transfer.sentences.map((s) => s.id));
  for (const [questions, refs] of [
    [file.questions, new Set(expected.keys())],
    [file.transfer.questions, transferIds],
  ] as const) {
    if (new Set(questions.map((q) => q.id)).size !== questions.length)
      errors.push('duplicate question IDs');
    for (const q of questions)
      for (const sid of q.sourceIds) if (!refs.has(sid)) errors.push(`unresolved support ${sid}`);
  }
  return errors;
}

export function gradeQuestions(questions: readonly Question[], answers: Record<string, string>) {
  return questions.map((q) => ({
    questionId: q.id,
    answer: answers[q.id] ?? '',
    correct: q.accepted.includes(answers[q.id] ?? ''),
  }));
}

export function finishCaseAttempt(
  file: CaseFile,
  draft: CaseDraft,
  previous: readonly CaseAttempt[],
  endedAt: number,
): CaseAttempt {
  const parsed = CaseDraftSchema.parse(draft);
  if (parsed.caseId !== file.id || parsed.revision !== file.revision)
    throw new Error('This case file has changed. Start a new attempt.');
  const activity = parsed.stage === 'story' ? file : file.transfer;
  if (!parsed.retelling.trim()) throw new Error('Add a short typed retelling before saving.');
  if (activity.questions.some((q) => !q.options.some((o) => o.id === parsed.answers[q.id])))
    throw new Error('Answer every question before saving.');
  if (parsed.checklist.some((i) => i >= activity.checklist.length))
    throw new Error('Invalid self-review item.');
  const results = gradeQuestions(activity.questions, parsed.answers);
  return CaseAttemptSchema.parse({
    ...parsed,
    endedAt: Math.max(parsed.startedAt, endedAt),
    packId: file.packId,
    packVersion: file.packVersion,
    storyId: file.storyId,
    exposure: previous.some(
      (p) => p.caseId === file.id && p.stage === parsed.stage && p.id !== parsed.id,
    )
      ? 'repeated'
      : 'first',
    grader: 'authored-key-and-self-review-v1',
    correctCount: results.filter((r) => r.correct).length,
    itemCount: results.length,
    results,
  });
}

export function parseAttempts(rows: readonly { detail: unknown }[]): CaseAttempt[] {
  return rows.flatMap((r) => {
    const parsed = CaseAttemptSchema.safeParse(r.detail);
    return parsed.success ? [parsed.data] : [];
  });
}
