import type { Exam, ExamSubtestKind } from '@sumrak/schema';

import { scoreSpeakingSubtest } from '../grading/speaking';
import { gradeWritingOffline } from '../grading/writing';
import { isAnswered, type ExamAnswer, type ExamResults, type SpeakingAnswer } from '../model';
import { roundPct, scoreItem, subtestPercent, type ItemOutcome } from '../scoring';
import { writingShare } from '../writing/writing-model';
import { verdict as computeVerdict, type FullVerdict } from '../verdict';
import { torflLevelOf } from '../level-profile';
import { isPlaceholderKind, type ExamRunState } from './exam-machine';

/**
 * Finishing a mock (T71) — PURE: from the exam, the final run state and the
 * answers, compute what `finishAttempt` stores: one result per SCORED
 * subtest (placeholders recorded skipped are excluded — not 0 %), the pcts
 * by kind, the SPbU verdict (full scope only, null until all five exist),
 * and the items that must enter the deck as misses.
 *
 * T72: a submitted WRITING subtest is scored here too — the offline
 * provisional grade (`gradeWritingOffline`, 55 → 100 rescaled) over its
 * letter(s), `provisional: true`, `gradedBy: 'offline'`. The AI grade later
 * rewrites that row through the grading queue (`recomputeResults`). Writing
 * items never enter the deck.
 *
 * T73: a submitted SPEAKING subtest is scored the same way — the offline
 * provisional grade per recorded answer (`scoreSpeakingSubtest`: judge /
 * coverage / estimate parts rescaled, 25 / 25 / 50 shares), `provisional:
 * true`, `gradedBy: 'offline'`; speaking items never enter the deck either.
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

export interface SubtestScore {
  result: ExamResults[string];
  missed: MissedItem[];
}

/** The provisional writing result of a subtest: each writing item is worth an equal share of `maxPoints`. */
export function scoreWritingSubtest(
  subtest: Exam['subtests'][number],
  answers: Record<string, ExamAnswer>,
): ExamResults[string] {
  const items = subtest.parts.flatMap((p) => p.items).filter((i) => i.kind === 'writing');
  const share = items.length > 0 ? writingShare(subtest) : 0;
  let points = 0;
  for (const item of items) {
    if (item.kind !== 'writing') continue;
    const a = answers[item.id];
    const text = a?.kind === 'writing' ? a.text : '';
    points += (gradeWritingOffline(item, text).pct / 100) * share;
  }
  points = Math.round(points * 10) / 10;
  return {
    points,
    maxPoints: subtest.maxPoints,
    pct:
      subtest.maxPoints > 0
        ? Math.min(100, Math.max(0, roundPct((points / subtest.maxPoints) * 100)))
        : 0,
    provisional: true,
    gradedBy: 'offline',
  };
}

/** The provisional speaking result of a subtest (T73). */
export function scoreSpeakingResult(
  subtest: Exam['subtests'][number],
  answers: Record<string, ExamAnswer>,
): ExamResults[string] {
  const speaking: Record<string, SpeakingAnswer> = {};
  for (const [id, a] of Object.entries(answers)) {
    if (
      a.kind === 'speaking-reply' ||
      a.kind === 'speaking-situation' ||
      a.kind === 'speaking-monologue'
    ) {
      speaking[id] = a;
    }
  }
  const r = scoreSpeakingSubtest(subtest, speaking);
  return {
    points: r.points,
    maxPoints: r.maxPoints,
    pct: r.pct,
    provisional: true,
    gradedBy: 'offline',
  };
}

/** Score ONE subtest from the answers: result + the items that were not full credit (objective kinds; writing / speaking → provisional). */
export function scoreSubtest(
  subtest: Exam['subtests'][number],
  answers: Record<string, ExamAnswer>,
): SubtestScore {
  if (subtest.kind === 'writing')
    return { result: scoreWritingSubtest(subtest, answers), missed: [] };
  if (subtest.kind === 'speaking')
    return { result: scoreSpeakingResult(subtest, answers), missed: [] };
  const scored: { points: number }[] = [];
  const missed: MissedItem[] = [];
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
  return {
    result: {
      points,
      maxPoints: subtest.maxPoints,
      pct: subtestPercent(scored, subtest),
      provisional: false,
      gradedBy: 'offline',
    },
    missed,
  };
}

export function computeFinish(
  exam: Exam,
  state: Pick<ExamRunState, 'subtests'>,
  answers: Record<string, ExamAnswer>,
  scope: 'full' | 'subtest',
): FinishComputation {
  const results: ExamResults = {};
  const pcts: Partial<Record<ExamSubtestKind, number>> = {};
  const provisionalKinds: Partial<Record<ExamSubtestKind, boolean>> = {};
  const missed: MissedItem[] = [];
  let scoredSubtests = 0;
  for (const run of state.subtests) {
    if (run.status !== 'submitted' || run.skipped || isPlaceholderKind(run.kind)) continue;
    const subtest = exam.subtests.find((s) => s.id === run.id);
    if (!subtest) continue;
    const { result, missed: subtestMissed } = scoreSubtest(subtest, answers);
    results[subtest.id] = result;
    pcts[subtest.kind] = result.pct;
    if (result.provisional) provisionalKinds[subtest.kind] = true;
    missed.push(...subtestMissed);
    scoredSubtests += 1;
  }
  return {
    results,
    pcts,
    // T73: the first five-subtest verdict is PROVISIONAL while writing / speaking are offline-graded.
    verdict:
      scope === 'full' ? computeVerdict(pcts, provisionalKinds, torflLevelOf(exam.level)) : null,
    missed,
    scoredSubtests,
  };
}
