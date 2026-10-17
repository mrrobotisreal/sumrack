import { z } from 'zod';

/** Per-pack resume state (FULL_STORY_LISTEN §5.4). */
export interface PackProgress {
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  finishedAt?: number;
}
export interface ListenProgress {
  v: 1;
  byPack: Record<string, PackProgress>;
}

export const PROGRESS_CAP = 200;
export const RESUME_THRESHOLD_MS = 5000;

export const EMPTY_PROGRESS: ListenProgress = { v: 1, byPack: {} };

const EntrySchema = z.object({
  positionMs: z.number().finite().min(0),
  durationMs: z.number().finite().min(0),
  updatedAt: z.number().finite().min(0),
  finishedAt: z.number().finite().min(0).optional(),
});

function cap(byPack: Record<string, PackProgress>): Record<string, PackProgress> {
  const ids = Object.keys(byPack);
  if (ids.length <= PROGRESS_CAP) return byPack;
  const keep = ids
    .sort((a, b) => byPack[b]!.updatedAt - byPack[a]!.updatedAt)
    .slice(0, PROGRESS_CAP);
  return Object.fromEntries(keep.map((id) => [id, byPack[id]!]));
}

/** Malformed -> empty; malformed entries dropped individually; capped at 200 (oldest dropped). */
export function sanitizeProgress(raw: unknown): ListenProgress {
  if (raw === null || typeof raw !== 'object') return { v: 1, byPack: {} };
  const by = (raw as { byPack?: unknown }).byPack;
  if (by === null || typeof by !== 'object' || Array.isArray(by)) return { v: 1, byPack: {} };
  const out: Record<string, PackProgress> = {};
  for (const [id, value] of Object.entries(by as Record<string, unknown>)) {
    const parsed = EntrySchema.safeParse(value);
    if (parsed.success) out[id] = parsed.data;
  }
  return { v: 1, byPack: cap(out) };
}

/** Where to open: saved position when > 5 s and not finished, else 0. */
export function resumePositionFor(progress: ListenProgress, packId: string): number {
  const e = progress.byPack[packId];
  if (!e || e.finishedAt != null) return 0;
  return e.positionMs > RESUME_THRESHOLD_MS ? e.positionMs : 0;
}

export function isFinished(progress: ListenProgress, packId: string): boolean {
  return progress.byPack[packId]?.finishedAt != null;
}

/** Record a position (clears nothing: finishedAt is cleared by `clearFinished` on play). */
export function markProgress(
  progress: ListenProgress,
  packId: string,
  positionMs: number,
  durationMs: number,
  now: number,
): ListenProgress {
  const prev = progress.byPack[packId];
  const entry: PackProgress = {
    positionMs: Math.max(0, Math.round(positionMs)),
    durationMs: Math.max(0, Math.round(durationMs)),
    updatedAt: now,
  };
  if (prev?.finishedAt != null) entry.finishedAt = prev.finishedAt;
  return { v: 1, byPack: cap({ ...progress.byPack, [packId]: entry }) };
}

export function markFinished(
  progress: ListenProgress,
  packId: string,
  durationMs: number,
  now: number,
): ListenProgress {
  return {
    v: 1,
    byPack: cap({
      ...progress.byPack,
      [packId]: {
        positionMs: 0,
        durationMs: Math.round(durationMs),
        updatedAt: now,
        finishedAt: now,
      },
    }),
  };
}

export function clearFinished(progress: ListenProgress, packId: string): ListenProgress {
  const e = progress.byPack[packId];
  if (!e || e.finishedAt == null) return progress;
  const { finishedAt: _f, ...rest } = e;
  return { v: 1, byPack: { ...progress.byPack, [packId]: rest } };
}

/** Library «NN %»; 100 when finished; 0 when never started. */
export function percentFor(progress: ListenProgress, packId: string): number {
  const e = progress.byPack[packId];
  if (!e) return 0;
  if (e.finishedAt != null) return 100;
  if (e.durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((e.positionMs / e.durationMs) * 100)));
}
