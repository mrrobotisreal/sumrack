import type { Exam, ExamSubtestKind } from '@sumrak/schema';

import type { ChatRequest } from '@/features/ai/client';
import { AiError, isRetriable, toAiError } from '@/features/ai/errors';
import type { RunChatResult } from '@/features/ai/runner';
import type { ResolvedRun } from '@/features/ai/run-profile';
import { parseExamGrade, type ExamGrade } from '@/features/ai/schemas';

import type { ExamAnswer, ExamGrading, ExamResults, ExamVerdict } from '../model';
import { verdict as computeVerdict } from '../verdict';

/**
 * The durable, KIND-AGNOSTIC exam grading queue (T72, TORFL_EXAM_PREP §6.2)
 * — PURE core on the `queue-core.ts` journal pattern: the durable queue is
 * `exam_responses.gradingStatus = 'pending-ai'` itself; this module decides
 * what to send, how to retry and what to write back, through injected deps
 * (vitest drives it with a fake chat). The wiring lives in `queue.ts`.
 *
 * **Grader registry.** One grader per subtest kind. T72 registers
 * `writing`; T73 registers `speaking` by adding a `GradingKind` entry with
 * its own `buildRequest` / `fold` — nothing in this file changes. A pending
 * response whose kind has no grader stays pending (never fails, never
 * drops): an older build that sees a newer kind simply waits.
 *
 * **Lifecycle per job:** build the request from the exam item + the stored
 * answer → chat (temperature 0.2, the preset's timeout) → `parseExamGrade`
 * (a malformed answer is `invalid-response`, retriable like the journal's) → `fold` the grade with the
 * response's existing `offline` grading into `{points, grading}` →
 * `writeGraded` → the attempt's `resultsJson` is recomputed from ALL its
 * responses (the subtest pct = the AI pct, `gradedBy: 'ai'`,
 * `provisional: false`) and the verdict re-derived (`gradedBy` of other
 * subtests untouched). Transient failures retry after 2 s / 8 s; the third
 * failure (or a non-retriable one) writes `ai-failed` with the error code —
 * never silently dropped, never retried again until «Повторить оценку».
 */

export const GRADING_RETRY_DELAYS_MS = [2_000, 8_000];
export const GRADING_TEMPERATURE = 0.2;

/** What the pump reads for one pending response (the repo's `PendingGradingJob` + its exam). */
export interface GradingJobInput {
  responseId: string;
  attemptId: string;
  packId: string;
  examId: string;
  subtestId: string;
  itemId: string;
  answer: ExamAnswer | null;
  grading: ExamGrading | null;
  /** The points already on the row (the offline provisional score) — kept on `ai-failed`. */
  points: number | null;
  maxPoints: number;
}

export interface GraderContext {
  exam: Exam;
  job: GradingJobInput;
  /** Optional story text resolver (the model letter / model answer): `null` when unavailable. */
  storyText: (storyId: string, sentenceIds?: readonly string[]) => Promise<string | null>;
}

export interface GradedWrite {
  points: number;
  grading: ExamGrading;
  /** The subtest percent the AI grade is worth (0–100). */
  pct: number;
}

export interface KindGrader {
  kind: ExamSubtestKind;
  /** Build the chat request; `null` = this job cannot be graded (item removed, foreign answer) → `ai-failed` with code `invalid-response`. */
  buildRequest: (ctx: GraderContext) => Promise<Omit<ChatRequest, 'model' | 'extras'> | null>;
  /** Fold the parsed grade + receipt into what the response row stores. */
  fold: (ctx: GraderContext, grade: ExamGrade, receipt: GradeReceipt) => GradedWrite;
}

export interface GradeReceipt {
  provider: string;
  model: string;
  quality: string;
  effort: string;
  gradedAt: number;
  costUsd?: number;
  ms: number;
}

export interface GradingQueueDeps {
  listPending: () => Promise<GradingJobInput[]>;
  loadExam: (packId: string, examId: string) => Promise<Exam | null>;
  /** Text of a story (or sentence run) in a pack — the model-letter anchor. */
  storyText: (
    packId: string,
    storyId: string,
    sentenceIds?: readonly string[],
  ) => Promise<string | null>;
  /** The resolved run profile (model + extras) for `exam-*` requests. */
  resolveRun: () => Promise<ResolvedRun>;
  chat: (
    feature: 'exam-writing' | 'exam-speaking',
    req: ChatRequest,
    run: ResolvedRun,
  ) => Promise<RunChatResult>;
  timeoutMs: (run: ResolvedRun) => number;
  writeGraded: (job: GradingJobInput, write: GradedWrite) => Promise<void>;
  writeFailed: (job: GradingJobInput, error: { code: string; attempts: number }) => Promise<void>;
  /** After a graded write: recompute + store the attempt's results/verdict (see `recomputeAttemptResults`). */
  recomputeAttempt: (attemptId: string) => Promise<void>;
  isOnline: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Analytics hooks (props: slugs/numbers only). */
  onScored?: (job: GradingJobInput, write: GradedWrite) => void;
  onFailed?: (job: GradingJobInput, code: string) => void;
  retryDelaysMs?: number[];
  graders: readonly KindGrader[];
}

export const GRADER_FEATURE: Record<string, 'exam-writing' | 'exam-speaking'> = {
  writing: 'exam-writing',
  speaking: 'exam-speaking',
};

/** Kind of the subtest a job belongs to, or null when the exam no longer has it. */
export function jobKind(
  exam: Exam,
  job: Pick<GradingJobInput, 'subtestId'>,
): ExamSubtestKind | null {
  return exam.subtests.find((s) => s.id === job.subtestId)?.kind ?? null;
}

/**
 * Drain every pending response. Returns how many reached `scored`. A key /
 * auth failure stops the pass (every job would fail identically).
 */
export async function processGradingQueue(deps: GradingQueueDeps): Promise<number> {
  const delays = deps.retryDelaysMs ?? GRADING_RETRY_DELAYS_MS;
  const pending = await deps.listPending();
  if (pending.length === 0) return 0;
  let done = 0;
  const examCache = new Map<string, Exam | null>();
  let run: ResolvedRun | null = null;

  for (const job of pending) {
    if (!(await deps.isOnline())) break;
    const key = `${job.packId}/${job.examId}`;
    if (!examCache.has(key)) examCache.set(key, await deps.loadExam(job.packId, job.examId));
    const exam = examCache.get(key) ?? null;
    if (!exam) {
      // The pack was removed underneath the attempt (§12): nothing to grade against.
      await deps.writeFailed(job, { code: 'invalid-response', attempts: 0 });
      deps.onFailed?.(job, 'invalid-response');
      continue;
    }
    const kind = jobKind(exam, job);
    const grader = kind ? deps.graders.find((g) => g.kind === kind) : undefined;
    if (!kind || !grader) {
      if (!kind) {
        await deps.writeFailed(job, { code: 'invalid-response', attempts: 0 });
        deps.onFailed?.(job, 'invalid-response');
      }
      // A kind with no grader in this build stays pending (T73 registers speaking).
      continue;
    }
    const ctx: GraderContext = {
      exam,
      job,
      storyText: (storyId, sentenceIds) => deps.storyText(job.packId, storyId, sentenceIds),
    };
    const request = await grader.buildRequest(ctx);
    if (!request) {
      await deps.writeFailed(job, { code: 'invalid-response', attempts: 0 });
      deps.onFailed?.(job, 'invalid-response');
      continue;
    }
    run ??= await deps.resolveRun();
    const feature = GRADER_FEATURE[kind] ?? 'exam-writing';

    let lastError: AiError | null = null;
    let attempts = 0;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      attempts = attempt + 1;
      const startedAt = deps.now();
      try {
        const result = await deps.chat(
          feature,
          { ...request, temperature: GRADING_TEMPERATURE, timeoutMs: deps.timeoutMs(run) },
          run,
        );
        const grade = parseExamGrade(result.content);
        if (!grade)
          throw new AiError('invalid-response', 'grade did not match the rubric contract');
        const receipt: GradeReceipt = {
          provider: run.profile.provider,
          model: result.model || run.model,
          quality: run.profile.quality,
          effort: run.profile.effort,
          gradedAt: deps.now(),
          costUsd: result.usage?.costUsd,
          ms: deps.now() - startedAt,
        };
        const write = grader.fold(ctx, grade, receipt);
        await deps.writeGraded(job, write);
        await deps.recomputeAttempt(job.attemptId);
        deps.onScored?.(job, write);
        done++;
        lastError = null;
        break;
      } catch (err) {
        lastError = toAiError(err);
        if (!isRetriable(lastError) || attempt === delays.length) break;
        await deps.sleep(delays[attempt]!);
      }
    }
    if (lastError) {
      await deps.writeFailed(job, { code: lastError.code, attempts });
      deps.onFailed?.(job, lastError.code);
      if (lastError.code === 'no-key' || lastError.code === 'http-auth') break;
    }
  }
  return done;
}

// --- results recompute (pure) ---------------------------------------------------------------

export interface ResponseLike {
  subtestId: string;
  points: number | null;
  gradingStatus: string;
  grading: ExamGrading | null;
}

/**
 * Recompute an attempt's `resultsJson` after a rubric subtest changed
 * (T72 AI / self grade): for every subtest of the exam that has a
 * writing / speaking response with a grade, the result becomes
 * `{points: Σ points, maxPoints, pct, provisional, gradedBy}` where
 * `gradedBy` = 'ai' when every response is AI-graded, 'self' when self,
 * else 'offline' (provisional = true). Objective subtests' results are
 * passed through untouched. Returns the new results + the full-scope
 * verdict (null when not full scope or any of the five is missing).
 */
export function recomputeResults(
  exam: Exam,
  current: ExamResults | null,
  responses: readonly ResponseLike[],
  scope: string,
): { results: ExamResults; verdict: ExamVerdict | null; provisional: boolean } {
  const results: ExamResults = { ...(current ?? {}) };
  for (const subtest of exam.subtests) {
    if (subtest.kind !== 'writing' && subtest.kind !== 'speaking') continue;
    const rows = responses.filter((r) => r.subtestId === subtest.id);
    if (rows.length === 0) continue;
    const graded = rows.filter((r) => r.grading?.ai || r.grading?.self || r.grading?.offline);
    if (graded.length === 0) continue;
    const points = rows.reduce((n, r) => n + (r.points ?? 0), 0);
    const allAi = rows.every((r) => r.gradingStatus === 'scored' && r.grading?.ai);
    const allSelf = rows.every((r) => r.gradingStatus === 'self-graded' && r.grading?.self);
    const gradedBy = allAi ? 'ai' : allSelf ? 'self' : 'offline';
    const provisional = !(allAi || allSelf);
    const pct = Math.min(100, Math.max(0, Math.round((points / subtest.maxPoints) * 1000) / 10));
    results[subtest.id] = { points, maxPoints: subtest.maxPoints, pct, provisional, gradedBy };
  }
  const pcts: Partial<Record<ExamSubtestKind, number>> = {};
  const provisionalKinds: Partial<Record<ExamSubtestKind, boolean>> = {};
  for (const subtest of exam.subtests) {
    const r = results[subtest.id];
    if (!r) continue;
    pcts[subtest.kind] = r.pct;
    if (r.provisional) provisionalKinds[subtest.kind] = true;
  }
  if (scope !== 'full') return { results, verdict: null, provisional: false };
  const v = computeVerdict(pcts, provisionalKinds);
  return { results, verdict: v.verdict, provisional: v.provisional };
}
