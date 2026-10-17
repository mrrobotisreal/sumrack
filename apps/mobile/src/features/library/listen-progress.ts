import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { repos } from '@/db';

// Local seam (T97): parses the `listen.progress` settings row written by T96.
// The coordinator may swap this for features/listen/progress.ts on merge.
const rowSchema = z.object({
  v: z.literal(1),
  byPack: z.record(
    z.string(),
    z.object({
      positionMs: z.number(),
      durationMs: z.number(),
      updatedAt: z.number().optional(),
      finishedAt: z.number().nullish(),
    }),
  ),
});

export interface ListenPackProgress {
  percent: number;
  finished: boolean;
}

/** packId → {percent 0–100, finished}; absent packs have no entry. Never throws. */
export function parseListenProgress(raw: unknown): Map<string, ListenPackProgress> {
  const out = new Map<string, ListenPackProgress>();
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return out;
  for (const [packId, p] of Object.entries(parsed.data.byPack)) {
    const finished = p.finishedAt != null;
    const percent =
      p.durationMs > 0
        ? Math.max(0, Math.min(100, Math.round((p.positionMs / p.durationMs) * 100)))
        : 0;
    if (finished || percent > 0) out.set(packId, { percent: finished ? 100 : percent, finished });
  }
  return out;
}

export function useListenProgress(): Map<string, ListenPackProgress> {
  const q = useQuery({
    queryKey: ['listen', 'progress'],
    queryFn: async () => parseListenProgress(await repos.settings.get<unknown>('listen.progress')),
  });
  return q.data ?? new Map();
}
