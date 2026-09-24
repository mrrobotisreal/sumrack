import { AMBIENT_THEMES, bedAfter, findBed, type AmbientBed, type AmbientThemeId } from './beds';

/**
 * Per-theme resume cursors (M15, design AMBIENT_SOUNDTRACKS §6): where the
 * rotation stopped, so a theme picks up where it left off instead of always
 * opening on bed 1. Persisted as a JSON blob under
 * `SETTING_KEYS.ambientCursors` and mirrored in `store/ambient-cursors.ts`.
 */

export interface AmbientCursor {
  /** Bed slug within the theme (`AMBIENT_THEMES[theme].beds`). */
  bed: string;
  /** Playback position within that bed, ms, clamped to `[0, durationMs]`. */
  positionMs: number;
}

export type AmbientCursors = Partial<Record<AmbientThemeId, AmbientCursor>>;

/** Never resume into the last five seconds of a bed — start the next one instead. */
export const END_SKIP_MS = 5000;

/**
 * Defensive parse of the stored blob: unknown themes and slugs the registry
 * no longer knows are dropped (a renamed bed just restarts that theme);
 * NaN/negative positions → 0; positions past the bed's end clamp to it.
 */
export function parseAmbientCursors(raw: unknown): AmbientCursors {
  const out: AmbientCursors = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const theme of Object.keys(AMBIENT_THEMES) as AmbientThemeId[]) {
    const entry = (raw as Record<string, unknown>)[theme];
    if (entry == null || typeof entry !== 'object') continue;
    const { bed, positionMs } = entry as Partial<AmbientCursor>;
    if (typeof bed !== 'string') continue;
    const known = findBed(theme, bed);
    if (!known) continue;
    const position =
      typeof positionMs === 'number' && Number.isFinite(positionMs)
        ? Math.max(0, Math.min(known.durationMs, Math.round(positionMs)))
        : 0;
    out[theme] = { bed: known.slug, positionMs: position };
  }
  return out;
}

/**
 * Where a theme starts playing (design §6 "Start"): no cursor → bed 1 at 0;
 * a cursor within `END_SKIP_MS` of its bed's end → the next bed at 0 (wrapping);
 * otherwise exactly as stored.
 */
export function nextStart(
  theme: AmbientThemeId,
  cursor: AmbientCursor | undefined,
): { bed: AmbientBed; positionMs: number } {
  const beds = AMBIENT_THEMES[theme].beds;
  const bed = cursor ? findBed(theme, cursor.bed) : undefined;
  if (!bed || !cursor) return { bed: beds[0]!, positionMs: 0 };
  const positionMs = Math.max(0, Math.min(bed.durationMs, cursor.positionMs));
  if (positionMs >= bed.durationMs - END_SKIP_MS) {
    return { bed: bedAfter(theme, bed.slug), positionMs: 0 };
  }
  return { bed, positionMs };
}
