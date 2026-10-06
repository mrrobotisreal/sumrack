import type { ExamSubtestKind } from '@sumrak/schema';

import { XP_TABLE } from '@/features/motivation/xp';

import type { ExamScope, ExamVerdict } from './model';

/**
 * Mock rewards (T71, TORFL §7.5) — PURE: how much XP a finished mock earns
 * and which achievements it unlocks. The motivation service applies them
 * (`recordExamFinished`); T72/T73's completion path calls the same function
 * once a five-subtest verdict exists, so the verdict-gated unlocks fire
 * whenever the first full verdict arrives.
 *
 * XP: 15 per SCORED subtest (a skipped placeholder earns nothing) + 60 for a
 * finished full mock + 100 the first time a verdict is pass / pass-borderline.
 *
 * Achievements (stable ids, never renamed):
 *  - `torfl-first-mock`  «Первый вариант» — any finished mock with a scored subtest;
 *  - `torfl-lexgram-90`  «Без словаря»   — lexgram ≥ 90 % (no dictionary allowed there);
 *  - `torfl-would-pass`  «Сдал бы!»       — a five-subtest verdict of pass / pass-borderline;
 *  - `torfl-margin`      «С запасом»      — a five-subtest verdict with all five ≥ 80 %.
 */

export const LEXGRAM_90_PCT = 90;
export const MARGIN_ALL_PCT = 80;

export interface ExamRewardInput {
  scope: ExamScope;
  /** Scored (non-skipped) subtests of the attempt. */
  scoredSubtests: number;
  pcts: Partial<Record<ExamSubtestKind, number>>;
  /** Null until all five subtests have a score. */
  verdict: ExamVerdict | null;
  /** True when no earlier finished mock already had a pass / pass-borderline verdict. */
  firstPass: boolean;
}

export function examXp(input: ExamRewardInput): number {
  let xp = input.scoredSubtests * XP_TABLE.examSubtestFinished;
  if (input.scope === 'full' && input.scoredSubtests > 0) xp += XP_TABLE.examFullFinished;
  if (input.verdict === 'pass' || input.verdict === 'pass-borderline') {
    if (input.firstPass) xp += XP_TABLE.examFirstPass;
  }
  return xp;
}

export type ExamAchievementId =
  'torfl-first-mock' | 'torfl-would-pass' | 'torfl-margin' | 'torfl-lexgram-90';

export function examAchievements(input: ExamRewardInput): ExamAchievementId[] {
  const out: ExamAchievementId[] = [];
  if (input.scoredSubtests > 0) out.push('torfl-first-mock');
  if ((input.pcts.lexgram ?? 0) >= LEXGRAM_90_PCT) out.push('torfl-lexgram-90');
  if (input.verdict === 'pass' || input.verdict === 'pass-borderline') out.push('torfl-would-pass');
  if (input.verdict !== null) {
    const five: ExamSubtestKind[] = ['writing', 'lexgram', 'reading', 'listening', 'speaking'];
    if (five.every((k) => (input.pcts[k] ?? 0) >= MARGIN_ALL_PCT)) out.push('torfl-margin');
  }
  return out;
}
