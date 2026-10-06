import type { ExamSubtestKind } from '@sumrak/schema';
import { Rating, type Grade } from 'ts-fsrs';

/**
 * The real-exam pace (T70, TORFL_EXAM_PREP §7.3, ticket «Technical notes»):
 * seconds per item = the subtest's minutes × 60 ÷ its item count on the A1
 * demo (lexgram 40 min / 70 = 34 s · reading 40 / 25 = 96 s · listening
 * 30 / 20 = 90 s). Drill grading, «Молния»'s pace bar and (T71) the timer
 * warning copy share these constants — never re-derive them elsewhere.
 */
export const PACE_SEC = {
  lexgram: 34,
  reading: 96,
  listening: 90,
} as const;

/** «Молния» draws this many lexgram items and shows a bar this long per item. */
export const LIGHTNING_ITEMS = 20;
export const LIGHTNING_PACE_SEC = PACE_SEC.lexgram;

/** A correct answer slower than this × the exam pace is graded Hard instead of Good. */
export const SLOW_FACTOR = 2;

/** Seconds per item at the exam pace; null for kinds with no objective pace (writing / speaking). */
export function paceSecFor(kind: string): number | null {
  return kind === 'lexgram' || kind === 'reading' || kind === 'listening' ? PACE_SEC[kind] : null;
}

export type DrillVerdict = 'full' | 'half' | 'wrong' | 'blank';

/**
 * Drill answer → FSRS rating (TORFL §7.1, the M6/T13 mapping family):
 * wrong / blank = Again; full credit within 2× the exam pace = Good; full
 * credit slower = Hard; HALF credit (typed, right meaning wrong form) = Hard
 * — it was recalled but the form is not yet there, so it returns sooner than
 * a Good without counting as a lapse. Easy is never emitted (recognition
 * cannot prove effortless recall — the MC precedent). An item kind with no
 * pace (should not happen in a drill) is treated as fast.
 */
export function ratingForDrillAnswer(
  outcome: DrillVerdict,
  ms: number,
  subtestKind: ExamSubtestKind | string,
): Grade {
  if (outcome === 'wrong' || outcome === 'blank') return Rating.Again;
  if (outcome === 'half') return Rating.Hard;
  const pace = paceSecFor(subtestKind);
  if (pace === null) return Rating.Good;
  return ms <= pace * SLOW_FACTOR * 1000 ? Rating.Good : Rating.Hard;
}

/** Fraction of the per-item pace elapsed (0..1+, the pace bar); 0 when the pace is unknown. */
export function paceFraction(ms: number, paceSec: number): number {
  return paceSec > 0 ? Math.max(0, ms) / (paceSec * 1000) : 0;
}

/** «Ваш темп» line numbers for the Молния end screen: average seconds per item, one decimal. */
export function averageSeconds(totalMs: number, items: number): number {
  return items > 0 ? Math.round(totalMs / items / 100) / 10 : 0;
}
