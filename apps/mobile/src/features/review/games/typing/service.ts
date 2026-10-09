import type { Repositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  computeTypingStats,
  xpForTypingRound,
  type TypingAttempt,
  type TypingRoundStats,
} from './engine';
import { mergeTypingStats, parseTypingStats, type TypingStats } from './stats';

/**
 * Typing-trainer persistence orchestration (T40). Deliberately FSRS-free:
 * this module never calls gradeCard / recordReviewOutcome and never writes
 * review_log or cards — the only writes are the game_sessions row, the
 * settings JSON, and the daily_activity XP/xp counter.
 *
 * Dependencies are passed in (not imported from the app-global `@/db`) so the
 * whole flow runs against `createTestDb()` in vitest. The screen passes the
 * real `repos` plus the motivation hooks.
 */

export interface TypingServiceDeps {
  repos: Pick<Repositories, 'stats' | 'settings'>;
  /** Goal/streak evaluation after XP lands (motivation `evaluateMotivation`). */
  evaluate: () => Promise<void>;
  /** Session-end sweep (motivation `onSessionEnded`). */
  onSessionEnded: () => Promise<void>;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface TypingRoundResult {
  stats: TypingRoundStats;
  xp: number;
  /** Lifetime stats after this round (merged + saved). */
  bests: { bestWpm: number; bestAccuracy: number };
  newBest: { wpm: boolean; accuracy: boolean };
}

/** Load the lifetime stats (healed to defaults on corrupt data). */
export async function loadTypingStats(repos: TypingServiceDeps['repos']): Promise<TypingStats> {
  return parseTypingStats(await repos.settings.get<unknown>(SETTING_KEYS.typingStats));
}

/** Open the game_sessions row for a round (called when the round starts). */
export async function startTypingRound(repos: TypingServiceDeps['repos']): Promise<string> {
  const row = await repos.stats.startGameSession('typing');
  return row.id;
}

/**
 * Finish a round: finish the game_sessions row, merge + save lifetime stats,
 * award XP into today's daily_activity, then run the motivation hooks.
 * A zero-word round still finishes its session row (0 XP, stats untouched).
 */
export async function finishTypingRound(
  deps: TypingServiceDeps,
  sessionId: string,
  attempts: readonly TypingAttempt[],
  elapsedMs: number,
): Promise<TypingRoundResult> {
  const { repos } = deps;
  const now = deps.now?.() ?? Date.now();
  const stats = computeTypingStats(attempts, elapsedMs);
  const xp = xpForTypingRound(stats);

  const prev = await loadTypingStats(repos);
  const next = mergeTypingStats(prev, stats, now);
  const newBest = {
    wpm: stats.words > 0 && stats.wpm > prev.bestWpm && next.bestWpm > prev.bestWpm,
    accuracy: stats.words > 0 && next.bestAccuracy > prev.bestAccuracy,
  };

  await repos.stats.finishGameSession(sessionId, {
    itemCount: stats.words,
    correctCount: stats.correctCount,
    detail: {
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      chars: stats.chars,
      correctChars: stats.correctChars,
      elapsedMs,
      xp,
    },
  });
  if (next !== prev) await repos.settings.set(SETTING_KEYS.typingStats, next);
  if (xp > 0) await repos.stats.bumpDailyActivity({ xp });
  await deps.evaluate();
  await deps.onSessionEnded();

  return {
    stats,
    xp,
    bests: { bestWpm: next.bestWpm, bestAccuracy: next.bestAccuracy },
    newBest,
  };
}
