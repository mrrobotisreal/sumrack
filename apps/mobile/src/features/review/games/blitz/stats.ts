import { z } from 'zod';

/**
 * Match-blitz lifetime stats (T34), one settings JSON row
 * (`SETTING_KEYS.blitzStats`) — no table, no migration (the T40 typing
 * precedent). Zod-validated on read: corrupt values heal to the defaults.
 * best = max pairs in any finished sprint; zero-pair sprints don't count.
 */

const BlitzStatsSchema = z.object({
  v: z.literal(1),
  best: z.number().int().min(0),
  rounds: z.number().int().min(0),
  totalPairs: z.number().int().min(0),
  lastPlayedAt: z.number().int().nullable(),
});

export type BlitzStats = z.infer<typeof BlitzStatsSchema>;

export const DEFAULT_BLITZ_STATS: BlitzStats = {
  v: 1,
  best: 0,
  rounds: 0,
  totalPairs: 0,
  lastPlayedAt: null,
};

export function parseBlitzStats(raw: unknown): BlitzStats {
  const parsed = BlitzStatsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_BLITZ_STATS;
}

/** Fold one finished sprint in. Pure; a 0-pair sprint returns `prev`. */
export function mergeBlitzStats(prev: BlitzStats, pairs: number, now: number): BlitzStats {
  if (pairs <= 0) return prev;
  return {
    v: 1,
    best: Math.max(prev.best, pairs),
    rounds: prev.rounds + 1,
    totalPairs: prev.totalPairs + pairs,
    lastPlayedAt: now,
  };
}
