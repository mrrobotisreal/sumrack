import { bandForStability } from '@/lib/mastery';
import { foldForAnswer, answersMatch } from '@/lib/text';
import { XP_TABLE } from '@/features/motivation/xp';

/**
 * The typing trainer's pure engine (T40, widget-typing-trainer §4). No DB,
 * no React: attempts in, stats and XP out, plus the weighted word picker.
 * Every decision that is not in the ticket is recorded here, in the doc
 * comment next to the code it governs.
 */

/**
 * Soft clock: 120 s per round (ticket). When time is up, the word currently
 * on screen may still be submitted, then the round ends — no new word is
 * served after the clock. The screen owns the clock; this is the length.
 */
export const ROUND_MS = 120_000;

/**
 * Accuracy floor (word-level). Below it: the round can't set a best WPM and
 * its XP is capped at the first bracket (XP_TABLE.typingRound[0]).
 */
export const MIN_ACCURACY_FOR_BEST_WPM = 0.7;

/** Words needed in a round before its accuracy can set the best accuracy. */
export const MIN_WORDS_FOR_BEST_ACCURACY = 10;

/** Characters per "word" in the WPM convention (5 keystrokes = 1 word). */
const CHARS_PER_WORD = 5;

/** One submitted word. `correct` is the shared comparator's verdict. */
export interface TypingAttempt {
  expected: string;
  typed: string;
  correct: boolean;
  msTaken: number;
}

export interface TypingRoundStats {
  /** Attempts submitted (= served words answered). */
  words: number;
  correctCount: number;
  /** Σ code points of the typed text, all attempts (right or wrong). */
  chars: number;
  /**
   * Σ over CORRECT attempts of (code points of the folded expected word + 1
   * separating space). The space is counted per correct word, so a round of
   * n correct words scores Σ(len+1), not Σ(len). Ticket decision.
   */
  correctChars: number;
  /** Word-level accuracy, 0–1 (correctCount / words; 0 with no attempts). */
  accuracy: number;
  /** WPM = (correctChars / 5) / minutes, rounded to 1 decimal; 0 when elapsed is 0. */
  wpm: number;
  elapsedMs: number;
}

/** Code-point length, so Cyrillic (and any future astral char) counts as one. */
function codePoints(text: string): number {
  return [...text].length;
}

/**
 * Round stats from the attempts and the elapsed time.
 *
 * Hand-checked example (see __tests__/typing-engine.test.ts): «дом»✓
 * «кошка»✓ «окно»✗ «ёлка» typed «елка»✓ over 30 000 ms →
 * correctChars = (3+1)+(5+1)+(4+1) = 15 → wpm = (15/5)/0.5 = 6.0;
 * accuracy = 3/4 = 0.75.
 */
export function computeTypingStats(
  attempts: readonly TypingAttempt[],
  elapsedMs: number,
): TypingRoundStats {
  let correctCount = 0;
  let correctChars = 0;
  let chars = 0;
  for (const a of attempts) {
    chars += codePoints(a.typed);
    if (a.correct) {
      correctCount += 1;
      correctChars += codePoints(foldForAnswer(a.expected)) + 1;
    }
  }
  const words = attempts.length;
  const minutes = elapsedMs / 60_000;
  const rawWpm = elapsedMs > 0 ? correctChars / CHARS_PER_WORD / minutes : 0;
  return {
    words,
    correctCount,
    chars,
    correctChars,
    accuracy: words > 0 ? correctCount / words : 0,
    wpm: Math.round(rawWpm * 10) / 10,
    elapsedMs,
  };
}

/** Compare a typed word to the expected one via the shared T13 comparator. */
export function judgeTypedWord(expected: string, typed: string): boolean {
  return answersMatch(expected, typed);
}

/**
 * XP for a finished round (data table: XP_TABLE.typingRound). Highest bracket
 * whose minWpm ≤ wpm; accuracy < 0.7 caps the round at the first bracket;
 * a zero-word round earns nothing.
 */
export function xpForTypingRound(
  stats: Pick<TypingRoundStats, 'words' | 'wpm' | 'accuracy'>,
): number {
  if (stats.words === 0) return 0;
  const brackets = XP_TABLE.typingRound;
  const first = brackets[0]!;
  if (stats.accuracy < MIN_ACCURACY_FOR_BEST_WPM) return first.xp;
  let xp: number = first.xp;
  for (const b of brackets) {
    if (stats.wpm >= b.minWpm) xp = b.xp;
  }
  return xp;
}

/** Sourcing weights by mastery band (ticket). Never-reviewed is treated as shaky (×3). */
export const TYPING_WEIGHTS = {
  learning: 3,
  young: 2,
  mature: 1,
  /** Collected but never reviewed (no band) — record: weighted like shaky. */
  unreviewed: 3,
} as const;

/** Skip the last N served ids when the pool is big enough to afford it. */
export const RECENT_SKIP_COUNT = 3;
export const RECENT_SKIP_MIN_POOL = 5;

export interface TypingCandidate {
  id: string;
  minCoreStability: number | null;
}

/** Weight of one candidate, from its weakest-link core stability. */
export function typingWeight(minCoreStability: number | null): number {
  const band = bandForStability(minCoreStability);
  return band == null ? TYPING_WEIGHTS.unreviewed : TYPING_WEIGHTS[band];
}

/**
 * Weighted next-word pick. With ≥ RECENT_SKIP_MIN_POOL candidates the last
 * RECENT_SKIP_COUNT served ids are excluded (no back-to-back repeats). The
 * floor guarantees ≥ 2 survivors, so the filtered pool is never empty.
 * `rng` is injectable (default Math.random) so the sourcing frequencies are
 * testable.
 */
export function pickNextWord<T extends TypingCandidate>(
  candidates: readonly T[],
  recentIds: readonly string[],
  rng: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;
  let pool: readonly T[] = candidates;
  if (candidates.length >= RECENT_SKIP_MIN_POOL) {
    const skip = new Set(recentIds.slice(-RECENT_SKIP_COUNT));
    pool = candidates.filter((c) => !skip.has(c.id));
  }
  const weights = pool.map((c) => typingWeight(c.minCoreStability));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r < 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}
