import type { Repositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';

import { dedupePool, shortGloss, xpForBlitz, type BlitzPair } from './engine';
import { mergeBlitzStats, parseBlitzStats, type BlitzStats } from './stats';

/**
 * Match-blitz persistence (T34). FSRS-free by construction: this module
 * never calls gradeCard / recordReviewOutcome and never writes review_log
 * or cards — the only writes are the game_sessions row (mode
 * 'match-blitz'), the settings JSON and the daily_activity XP counter.
 * Dependencies are passed in so the flow runs against `createTestDb()`.
 */

export interface BlitzServiceDeps {
  repos: Pick<Repositories, 'stats' | 'settings' | 'bank'>;
  evaluate: () => Promise<void>;
  onSessionEnded: () => Promise<void>;
  now?: () => number;
}

export async function loadBlitzStats(repos: Pick<Repositories, 'settings'>): Promise<BlitzStats> {
  return parseBlitzStats(await repos.settings.get<unknown>(SETTING_KEYS.blitzStats));
}

/** The deduped young+mature pool, glosses shortened to their first sense. */
export async function loadBlitzPool(repos: Pick<Repositories, 'bank'>): Promise<BlitzPair[]> {
  const rows = await repos.bank.listBlitzCandidates();
  return dedupePool(rows.map((r) => ({ id: r.id, ru: r.ru, en: shortGloss(r.en) })));
}

export async function startBlitzRound(
  repos: Pick<Repositories, 'stats'>,
  poolSize: number,
): Promise<string> {
  const row = await repos.stats.startGameSession('match-blitz', { poolSize });
  return row.id;
}

export interface BlitzRoundInput {
  pairs: number;
  misses: number;
  penaltyMs: number;
  poolSize: number;
  /** False when the sprint was quit before the clock ran out. */
  completed: boolean;
}

export interface BlitzRoundResult {
  pairs: number;
  xp: number;
  best: number;
  newBest: boolean;
}

/**
 * Finish a sprint. A completed sprint earns XP by bracket and can set the
 * best; a quit sprint closes its row with what was matched and moves
 * nothing else.
 */
export async function finishBlitzRound(
  deps: BlitzServiceDeps,
  sessionId: string,
  input: BlitzRoundInput,
): Promise<BlitzRoundResult> {
  const { repos } = deps;
  const now = deps.now?.() ?? Date.now();
  const xp = input.completed ? xpForBlitz(input.pairs) : 0;
  const prev = await loadBlitzStats(repos);
  const next = input.completed ? mergeBlitzStats(prev, input.pairs, now) : prev;

  await repos.stats.finishGameSession(sessionId, {
    itemCount: input.pairs + input.misses,
    correctCount: input.pairs,
    detail: {
      score: input.pairs,
      misses: input.misses,
      penaltyMs: input.penaltyMs,
      poolSize: input.poolSize,
      completed: input.completed,
      xp,
    },
  });
  if (next !== prev) await repos.settings.set(SETTING_KEYS.blitzStats, next);
  if (xp > 0) await repos.stats.bumpDailyActivity({ xp });
  await deps.evaluate();
  if (input.completed) await deps.onSessionEnded();
  return { pairs: input.pairs, xp, best: next.best, newBest: next.best > prev.best };
}
