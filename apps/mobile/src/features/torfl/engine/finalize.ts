import type { Exam } from '@sumrak/schema';
import { Rating } from 'ts-fsrs';

import type { Repositories } from '@/db/repositories';

import type { ExamAnswer, ExamResults, ExamScope, ExamVerdict } from '../model';
import { computeFinish, type FinishComputation } from './finish';
import type { ExamRunState } from './exam-machine';
import type { ExamRewardInput } from '../rewards';

/**
 * Closing a mock attempt in the database (T71) — the one write path that
 * turns a finished run into `exam_attempts` results/verdict/XP and, only
 * AFTER the attempt is finished (TORFL §7.2 «no spoilers»), puts every
 * missed item into the exam deck: wrong / unanswered → graded Again (due
 * now, `last_result = 'wrong'`), typed half credit → Hard. Pure over its
 * injected repo + reward callback so it is tested on the real schema.
 */

type FinalizeRepo = Pick<Repositories['exams'], 'finishAttempt' | 'ensureCard' | 'gradeCard'>;

export interface FinalizeDeps {
  exams: FinalizeRepo;
  /** Applies XP + achievements once; returns the XP awarded (stored on the attempt). */
  rewards: (
    input: Omit<ExamRewardInput, 'firstPass'>,
    opts: { excludeAttemptId: string },
  ) => Promise<{ xp: number }>;
  now?: number;
}

export interface FinalizeOutcome {
  results: ExamResults;
  verdict: ExamVerdict | null;
  provisional: boolean;
  xp: number;
  finish: FinishComputation;
  deckAdded: number;
}

export async function finalizeAttempt(
  deps: FinalizeDeps,
  args: {
    attemptId: string;
    packId: string;
    examId: string;
    scope: Exclude<ExamScope, 'drill'>;
    exam: Exam;
    state: Pick<ExamRunState, 'subtests'>;
    answers: Record<string, ExamAnswer>;
  },
): Promise<FinalizeOutcome> {
  const now = deps.now ?? Date.now();
  const finish = computeFinish(args.exam, args.state, args.answers, args.scope);
  const verdict = finish.verdict?.verdict ?? null;
  const { xp } = await deps.rewards(
    {
      scope: args.scope,
      scoredSubtests: finish.scoredSubtests,
      pcts: finish.pcts,
      verdict,
    },
    { excludeAttemptId: args.attemptId },
  );
  await deps.exams.finishAttempt(args.attemptId, finish.results, verdict, xp, now);

  let deckAdded = 0;
  for (const m of finish.missed) {
    await deps.exams.ensureCard({
      packId: args.packId,
      examId: args.examId,
      itemId: m.itemId,
      subtestKind: m.kind,
      topic: m.topic,
      now,
    });
    await deps.exams.gradeCard(
      `${args.packId}:${args.examId}:${m.itemId}`,
      m.outcome === 'half' ? Rating.Hard : Rating.Again,
      now,
    );
    deckAdded += 1;
  }
  return {
    results: finish.results,
    verdict,
    provisional: finish.verdict?.provisional ?? false,
    xp,
    finish,
    deckAdded,
  };
}
