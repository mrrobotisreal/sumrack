import { z } from 'zod';

import type { TypingRoundStats } from './engine';
import { MIN_ACCURACY_FOR_BEST_WPM, MIN_WORDS_FOR_BEST_ACCURACY } from './engine';

/**
 * Typing-trainer lifetime stats (T40), stored as one settings JSON row
 * (`SETTING_KEYS.typingStats`) — no table, no migration. Zod-validated on
 * read: a corrupt or foreign-shaped value heals to the defaults, never throws.
 *
 * Best rules (recorded decisions):
 * - bestWpm = max WPM over rounds with accuracy ≥ 0.7 (a sloppy burst can't
 *   set a speed record).
 * - bestAccuracy = max accuracy over rounds with ≥ 10 words (a 2-word
 *   round at 100 % is not a meaningful accuracy record).
 * Zero-word rounds don't count as rounds at all.
 */

const TypingStatsSchema = z.object({
  v: z.literal(1),
  bestWpm: z.number().finite().min(0),
  bestAccuracy: z.number().finite().min(0).max(1),
  rounds: z.number().int().min(0),
  totalWords: z.number().int().min(0),
  totalCorrectChars: z.number().int().min(0),
  lastPlayedAt: z.number().int().nullable(),
});

export type TypingStats = z.infer<typeof TypingStatsSchema>;

export const DEFAULT_TYPING_STATS: TypingStats = {
  v: 1,
  bestWpm: 0,
  bestAccuracy: 0,
  rounds: 0,
  totalWords: 0,
  totalCorrectChars: 0,
  lastPlayedAt: null,
};

/** Heal-to-defaults parse for the settings value. */
export function parseTypingStats(raw: unknown): TypingStats {
  const parsed = TypingStatsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_TYPING_STATS;
}

/** Does this round qualify for the best-WPM record? */
export function qualifiesForBestWpm(round: Pick<TypingRoundStats, 'accuracy'>): boolean {
  return round.accuracy >= MIN_ACCURACY_FOR_BEST_WPM;
}

/** Does this round qualify for the best-accuracy record? */
export function qualifiesForBestAccuracy(round: Pick<TypingRoundStats, 'words'>): boolean {
  return round.words >= MIN_WORDS_FOR_BEST_ACCURACY;
}

/**
 * Fold one finished round into the lifetime stats. Pure. A zero-word round
 * returns `prev` unchanged (nothing was typed, so nothing to count).
 */
export function mergeTypingStats(
  prev: TypingStats,
  round: Pick<TypingRoundStats, 'words' | 'correctChars' | 'wpm' | 'accuracy'>,
  now: number,
): TypingStats {
  if (round.words === 0) return prev;
  return {
    v: 1,
    bestWpm: qualifiesForBestWpm(round) ? Math.max(prev.bestWpm, round.wpm) : prev.bestWpm,
    bestAccuracy: qualifiesForBestAccuracy(round)
      ? Math.max(prev.bestAccuracy, round.accuracy)
      : prev.bestAccuracy,
    rounds: prev.rounds + 1,
    totalWords: prev.totalWords + round.words,
    totalCorrectChars: prev.totalCorrectChars + round.correctChars,
    lastPlayedAt: now,
  };
}
