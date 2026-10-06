import type { Exam, ExamSubtestKind } from '@sumrak/schema';

import { isAnswered, type ExamAnswer, type ExamResults } from '../model';
import { scoreItem, subtestPercent, type ItemOutcome } from '../scoring';
import { verdict as computeVerdict, type FullVerdict } from '../verdict';
import { isPlaceholderKind, type ExamRunState } from './exam-machine';

/**
 * Finishing a mock (T71) — PURE: from the exam, the final run state and the
 * answers, compute what `finishAttempt` stores: one result per SCORED
 * objective subtest (placeholders recorded skipped are excluded — not 0 %),
 * the pcts by kind, the SPbU verdict (full scope only, null until all five
 * exist), and the items that must enter the deck as misses.
 */

export interface MissedItem {
  subtestId: string;
  itemId: string;
  topic: string;
  kind: ExamSubtestKind;
  /** wrong = answered wrong; blank = left unanswered; half = typed half credit. */
  outcome: Exclude<ItemOutcome, 'full'>;
}

export interface FinishComputation {
  results: ExamResults;
  pcts: Partial<Record<ExamSubtestKind, number>>;
  verdict: FullVerdict | null;
  missed: MissedItem[];
  /** Σ over scored subtests of answered items (diagnostics). */
  scoredSubtests: number;
}

/** The scoring argument for `item`'s kind; a missing / foreign-kind answer is a blank. */
function answerArg(
  itemKind: string,
  answer: ExamAnswer | undefined,
): { index: number | null } | { text: string } {
  if (itemKind === 'typed') return { text: answer?.kind === 'typed' ? answer.text : '' };
  return { index: answer?.kind === 'choice' ? answer.index : null };
}

export function computeFinish(
  exam: Exam,
  state: Pick<ExamRunState, 'subtests'>,
  answers: Record<string, ExamAnswer>,
  scope: 'full' | 'subtest',
): FinishComputation {
  const results: ExamResults = {};
  const pcts: Partial<Record<ExamSubtestKind, number>> = {};
  const missed: MissedItem[] = [];
  let scoredSubtests = 0;
  for (const run of state.subtests) {
    if (run.status !== 'submitted' || run.skipped || isPlaceholderKind(run.kind)) continue;
    const subtest = exam.subtests.find((s) => s.id === run.id);
    if (!subtest) continue;
    const scored: { points: number }[] = [];
    let points = 0;
    for (const part of subtest.parts) {
      for (const item of part.items) {
        const answer = answers[item.id];
        const score = scoreItem(
          item,
          answerArg(item.kind, answer && isAnswered(answer) ? answer : undefined),
          subtest,
        );
        if (!score) continue;
        scored.push({ points: score.points });
        points += score.points;
        if (score.outcome !== 'full') {
          missed.push({
            subtestId: subtest.id,
            itemId: item.id,
            topic: item.topic,
            kind: subtest.kind,
            outcome: score.outcome,
          });
        }
      }
    }
    const pct = subtestPercent(scored, subtest);
    results[subtest.id] = {
      points,
      maxPoints: subtest.maxPoints,
      pct,
      provisional: false,
      gradedBy: 'offline',
    };
    pcts[subtest.kind] = pct;
    scoredSubtests += 1;
  }
  return {
    results,
    pcts,
    verdict: scope === 'full' ? computeVerdict(pcts) : null,
    missed,
    scoredSubtests,
  };
}
