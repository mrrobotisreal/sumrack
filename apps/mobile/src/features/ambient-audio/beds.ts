import { AMBIENT_BED_SOURCES, type AmbientBedSlug } from './sources';

/**
 * The bed registry (M15, design AMBIENT_SOUNDTRACKS §5): every bundled study
 * soundtrack, by theme, in rotation order. Hand-written (Metro needs literal
 * `require()` calls — they live in `sources.ts`, keyed by slug); `beds.test.ts`
 * reconciles it against the generated ledger `assets/audio/ambient/beds.json`
 * (slugs, order, durations). Re-encode with `pnpm --filter sumrak-mobile encode:ambient`.
 */

export type AmbientThemeId = 'horror' | 'news' | 'comedy' | 'action' | 'education';

export interface AmbientBed {
  /** Persisted cursor key (T48) — stable; never renumbered. */
  slug: AmbientBedSlug;
  /** Settings / analytics label. */
  title: string;
  /** From `beds.json`. */
  durationMs: number;
  /** Metro asset id — the `require()`d Opus file. */
  source: number;
}

export interface AmbientTheme {
  id: AmbientThemeId;
  label: { en: string; ru: string };
  /** Rotation order; length ≥ 1. */
  beds: readonly AmbientBed[];
}

/** Every context that is not a specific match (design §3.1). */
export const DEFAULT_AMBIENT_THEME: AmbientThemeId = 'horror';

/** Settings list order (T49) = the script's theme order. */
export const AMBIENT_THEME_ORDER: readonly AmbientThemeId[] = [
  'horror',
  'news',
  'comedy',
  'action',
  'education',
];

export const AMBIENT_THEMES: Record<AmbientThemeId, AmbientTheme> = {
  horror: {
    id: 'horror',
    label: { en: 'Horror & everything else', ru: 'Ужасы и всё остальное' },
    beds: [
      {
        slug: 'creepy-bg-music',
        title: 'Creepy Bg Music',
        durationMs: 800007,
        source: AMBIENT_BED_SOURCES['creepy-bg-music'],
      },
    ],
  },
  news: {
    id: 'news',
    label: { en: 'News', ru: 'Новости' },
    beds: [
      {
        slug: 'global-affairs-briefing-1',
        title: 'Global Affairs Briefing 1',
        durationMs: 67207,
        source: AMBIENT_BED_SOURCES['global-affairs-briefing-1'],
      },
      {
        slug: 'global-affairs-briefing-2',
        title: 'Global Affairs Briefing 2',
        durationMs: 124327,
        source: AMBIENT_BED_SOURCES['global-affairs-briefing-2'],
      },
    ],
  },
  comedy: {
    id: 'comedy',
    label: { en: 'Comedy', ru: 'Комедия' },
    beds: [
      {
        slug: 'return-to-the-motif-1',
        title: 'Return To The Motif 1',
        durationMs: 78007,
        source: AMBIENT_BED_SOURCES['return-to-the-motif-1'],
      },
      {
        slug: 'return-to-the-motif-2',
        title: 'Return To The Motif 2',
        durationMs: 72367,
        source: AMBIENT_BED_SOURCES['return-to-the-motif-2'],
      },
    ],
  },
  action: {
    id: 'action',
    label: { en: 'Action', ru: 'Боевик' },
    beds: [
      {
        slug: 'tactical-breach-1',
        title: 'Tactical Breach 1',
        durationMs: 164367,
        source: AMBIENT_BED_SOURCES['tactical-breach-1'],
      },
      {
        slug: 'tactical-breach-2',
        title: 'Tactical Breach 2',
        durationMs: 164567,
        source: AMBIENT_BED_SOURCES['tactical-breach-2'],
      },
    ],
  },
  education: {
    id: 'education',
    label: { en: 'Study focus', ru: 'Учёба' },
    beds: [
      {
        slug: 'mechanical-focus-1',
        title: 'Mechanical Focus 1',
        durationMs: 413607,
        source: AMBIENT_BED_SOURCES['mechanical-focus-1'],
      },
      {
        slug: 'mechanical-focus-2',
        title: 'Mechanical Focus 2',
        durationMs: 419007,
        source: AMBIENT_BED_SOURCES['mechanical-focus-2'],
      },
      {
        slug: 'laboratory-groove-1',
        title: 'Laboratory Groove 1',
        durationMs: 415007,
        source: AMBIENT_BED_SOURCES['laboratory-groove-1'],
      },
      {
        slug: 'laboratory-groove-2',
        title: 'Laboratory Groove 2',
        durationMs: 354367,
        source: AMBIENT_BED_SOURCES['laboratory-groove-2'],
      },
    ],
  },
};

/** The bed with `slug` in `theme`, or undefined (unknown/stale cursor → caller falls back to bed 1). */
export function findBed(theme: AmbientThemeId, slug: string): AmbientBed | undefined {
  return AMBIENT_THEMES[theme].beds.find((bed) => bed.slug === slug);
}

/** The next bed in rotation after `slug`, wrapping to the first; unknown slug → the first bed. */
export function bedAfter(theme: AmbientThemeId, slug: string): AmbientBed {
  const beds = AMBIENT_THEMES[theme].beds;
  const i = beds.findIndex((bed) => bed.slug === slug);
  return beds[(i + 1) % beds.length]!;
}
