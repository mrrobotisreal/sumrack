import { z } from 'zod';

import type { Repositories } from '@/db/repositories';

import {
  mergeBandTallies,
  NUMBERS_BANDS,
  ROUND_SIZE,
  suggestTier,
  tallyBands,
  xpForNumbersRound,
  type BandTally,
  type NumbersAttempt,
  type NumbersTier,
  type TierRound,
} from './engine';

/**
 * Numbers-drill persistence (T34). Recorded decision: NO new table — each
 * round is one `game_sessions` row (mode 'numbers') whose `detail` carries
 * the tier and the per-band tallies; lifetime band accuracy and the
 * suggested tier are a pure aggregation over those rows. FSRS-free: nothing
 * here touches cards or review_log.
 *
 * Dependencies are passed in so the flow runs against `createTestDb()`.
 */

export interface NumbersServiceDeps {
  repos: Pick<Repositories, 'stats'>;
  /** Goal/streak evaluation after XP lands (motivation `evaluateMotivation`). */
  evaluate: () => Promise<void>;
  /** Session-end sweep (motivation `onSessionEnded`). */
  onSessionEnded: () => Promise<void>;
}

const tallySchema = z.object({ seen: z.number().int().min(0), correct: z.number().int().min(0) });

/** `game_sessions.detail` for a numbers round — Zod-validated on read. */
const NumbersDetailSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  bands: z.partialRecord(z.enum(NUMBERS_BANDS as [string, ...string[]]), tallySchema),
  /** True when all ROUND_SIZE items were answered (partial rounds earn no XP, no quest). */
  completed: z.boolean(),
  replays: z.number().int().min(0).optional(),
  xp: z.number().int().min(0).optional(),
});
export type NumbersDetail = z.infer<typeof NumbersDetailSchema>;

export interface NumbersLifetime {
  rounds: number;
  bands: BandTally;
  /** Recent rounds, newest first (for the suggestion). */
  recent: TierRound[];
  suggested: NumbersTier;
}

/** Lifetime band accuracy + suggested tier, aggregated from game_sessions. */
export async function loadNumbersStats(
  repos: NumbersServiceDeps['repos'],
): Promise<NumbersLifetime> {
  const rows = await repos.stats.listFinishedGameSessions('numbers', { limit: 500 });
  const details: { detail: NumbersDetail; correct: number; total: number }[] = [];
  for (const row of rows) {
    const parsed = NumbersDetailSchema.safeParse(row.detail);
    if (parsed.success) {
      details.push({ detail: parsed.data, correct: row.correctCount, total: row.itemCount });
    }
  }
  const recent: TierRound[] = details
    .filter((d) => d.total > 0)
    .map((d) => ({ tier: d.detail.tier, correct: d.correct, total: d.total }));
  return {
    rounds: details.filter((d) => d.detail.completed).length,
    bands: mergeBandTallies(details.map((d) => d.detail.bands as BandTally)),
    recent,
    suggested: suggestTier(recent),
  };
}

/** Open the game_sessions row when a round starts. */
export async function startNumbersRound(
  repos: NumbersServiceDeps['repos'],
  tier: NumbersTier,
): Promise<string> {
  const row = await repos.stats.startGameSession('numbers', { tier });
  return row.id;
}

export interface NumbersRoundResult {
  correct: number;
  total: number;
  xp: number;
  completed: boolean;
  bands: BandTally;
}

/**
 * Finish a round: close the game_sessions row with the band tallies; a
 * COMPLETE round (all ROUND_SIZE answered) also earns XP and runs the
 * motivation hooks. A partial round (quit) still records its tallies.
 */
export async function finishNumbersRound(
  deps: NumbersServiceDeps,
  sessionId: string,
  tier: NumbersTier,
  attempts: readonly NumbersAttempt[],
): Promise<NumbersRoundResult> {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.correct).length;
  const completed = total >= ROUND_SIZE;
  const xp = completed ? xpForNumbersRound(correct, total) : 0;
  const bands = tallyBands(attempts);
  const replays = attempts.reduce((a, x) => a + Math.max(0, x.plays - 1), 0);
  const detail: NumbersDetail = { tier, bands, completed, replays, xp };
  await deps.repos.stats.finishGameSession(sessionId, {
    itemCount: total,
    correctCount: correct,
    detail,
  });
  if (xp > 0) await deps.repos.stats.bumpDailyActivity({ xp });
  await deps.evaluate();
  if (completed) await deps.onSessionEnded();
  return { correct, total, xp, completed, bands };
}
