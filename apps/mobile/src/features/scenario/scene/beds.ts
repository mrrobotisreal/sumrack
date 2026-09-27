import { SCENE_BED_SOURCES } from './bed-sources';

/**
 * Scene beds (T61, SPEAKING_SCENARIOS §8.4): bundled room tones that sit
 * UNDER the cast's speech — not study soundtracks (never routed through the
 * M15 controller). The known slugs are the six families' rooms + `none`;
 * the registry lists only the slugs whose Opus exists in
 * `assets/audio/scene/` (encoded by `pnpm --filter sumrak-mobile encode:scene`
 * at −32 LUFS from the workspace-root `assets/audio/scene/` masters),
 * reconciled against the `beds.json` ledger by `scene-beds.test.ts`.
 *
 * Ticket-time state (2026-09-27): NO room-tone masters exist, so the
 * registry ships with `none` only — every pack slug resolves to silence
 * (§12 "bed asset missing ⇒ silence"). Adding a bed = drop the master in,
 * run the encoder, add the literal `require()` to `bed-sources.ts` and the
 * row below.
 */

export const SCENE_BED_SLUGS = [
  'none',
  'studio',
  'clinic',
  'bank',
  'forecourt',
  'station',
  'night-shop',
] as const;

export type KnownSceneBedSlug = (typeof SCENE_BED_SLUGS)[number];

export interface SceneBed {
  slug: Exclude<KnownSceneBedSlug, 'none'>;
  title: string;
  durationMs: number;
  /** Metro asset id. */
  source: number;
}

/** Hand-written like M15's `AMBIENT_THEMES`; one row per encoded bed. */
export const SCENE_BEDS: readonly SceneBed[] = [];

/** Bed volume is `prefs.bedVolume` × this while a line plays or the mic records (§8.4). */
export const BED_DUCK = 0.35;

/** §4.4 default until T62's prefs store lands. */
export const DEFAULT_BED_VOLUME = 0.6;

/** The bed for a pack's `scene.bed`; unknown, `none`, or not-yet-encoded ⇒ undefined (silence). */
export function findSceneBed(slug: string | null | undefined): SceneBed | undefined {
  if (!slug || slug === 'none') return undefined;
  return SCENE_BEDS.find((bed) => bed.slug === slug);
}

/** True for a slug the app knows about (even one with no asset yet). */
export function isKnownSceneBedSlug(slug: string): slug is KnownSceneBedSlug {
  return (SCENE_BED_SLUGS as readonly string[]).includes(slug);
}

/** Keeps the type-level tie between the registry and the literal sources. */
export const SCENE_BED_SOURCE_COUNT = Object.keys(SCENE_BED_SOURCES).length;
