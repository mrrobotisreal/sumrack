import type { IoniconName } from '@/features/library/categories';

import { AMBIENT_THEMES, type AmbientThemeId } from './beds';
import type { AmbientPrefs } from './preferences';

/**
 * Pure helpers behind the Settings «Soundtracks» list (M15/T49, design
 * AMBIENT_SOUNDTRACKS §8). Rendering lives in `soundtracks-list.tsx`.
 */

/** The M14 Library icon for the matching category/genre (`features/library/categories.ts`). */
export const SOUNDTRACK_ICONS: Record<AmbientThemeId, IoniconName> = {
  horror: 'skull-outline',
  news: 'newspaper-outline',
  comedy: 'happy-outline',
  action: 'flash-outline',
  education: 'school-outline',
};

/** `m:ss` from milliseconds, rounded to the nearest second (`800007` → `13:20`, `0` → `0:00`). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `1 track` / `2 tracks`. */
export function formatTrackCount(count: number): string {
  return `${count} ${count === 1 ? 'track' : 'tracks'}`;
}

/** Sum of a theme's bed durations, ms. */
export function themeDurationMs(theme: AmbientThemeId): number {
  return AMBIENT_THEMES[theme].beds.reduce((sum, bed) => sum + bed.durationMs, 0);
}

/**
 * Why a preview would be silent right now, or `null` when it can play. A
 * preview is an ordinary registered activity through the single engine, so
 * it obeys `shouldPlayAmbience` exactly — the hint explains the rule instead
 * of letting ▶ be a silent no-op.
 */
export function previewDisabledReason(prefs: AmbientPrefs, narrating: boolean): string | null {
  if (!prefs.enabled) return 'Turn on study ambience to preview.';
  if (prefs.volume <= 0) return 'Turn up the music volume to preview.';
  if (narrating && !prefs.playDuringNarration) {
    return 'Pause narration to preview, or turn on «Play during narration».';
  }
  return null;
}
