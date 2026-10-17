import { z } from 'zod';

/** Speed notches (FULL_STORY_LISTEN §5.5). Never above 2: expo-audio clamps there. */
export const LISTEN_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type ListenRate = (typeof LISTEN_RATES)[number];

export interface ListenPrefs {
  v: 1;
  rate: ListenRate;
  volume: number;
  muted: boolean;
}

export const LISTEN_PREFS_DEFAULTS: ListenPrefs = { v: 1, rate: 1, volume: 1, muted: false };

/** Snap any number to the nearest-equal notch; unknown values -> null. */
export function toListenRate(value: unknown): ListenRate | null {
  if (typeof value !== 'number') return null;
  return LISTEN_RATES.find((r) => Math.abs(r - value) < 0.001) ?? null;
}

const FieldSchemas = {
  volume: z.number().finite().min(0).max(1),
  muted: z.boolean(),
};

/** Each field heals independently to its default; a non-object heals fully. */
export function sanitizeListenPrefs(raw: unknown): ListenPrefs {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const volume = FieldSchemas.volume.safeParse(obj.volume);
  const muted = FieldSchemas.muted.safeParse(obj.muted);
  return {
    v: 1,
    rate: toListenRate(obj.rate) ?? LISTEN_PREFS_DEFAULTS.rate,
    volume: volume.success ? volume.data : LISTEN_PREFS_DEFAULTS.volume,
    muted: muted.success ? muted.data : LISTEN_PREFS_DEFAULTS.muted,
  };
}
