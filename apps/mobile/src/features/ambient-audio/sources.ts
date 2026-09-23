/**
 * The `require()`d Opus assets behind the bed registry, keyed by bed slug.
 * Split out of `beds.ts` so unit tests can `vi.mock` this module — vitest
 * resolves `require()` natively and would try to parse the Opus bytes as
 * JavaScript. Metro needs every path literal (no dynamic `require`).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export const AMBIENT_BED_SOURCES = {
  'creepy-bg-music': require('../../../assets/audio/ambient/horror/01-creepy-bg-music.opus'),
  'global-affairs-briefing-1': require('../../../assets/audio/ambient/news/01-global-affairs-briefing-1.opus'),
  'global-affairs-briefing-2': require('../../../assets/audio/ambient/news/02-global-affairs-briefing-2.opus'),
  'return-to-the-motif-1': require('../../../assets/audio/ambient/comedy/01-return-to-the-motif-1.opus'),
  'return-to-the-motif-2': require('../../../assets/audio/ambient/comedy/02-return-to-the-motif-2.opus'),
  'tactical-breach-1': require('../../../assets/audio/ambient/action/01-tactical-breach-1.opus'),
  'tactical-breach-2': require('../../../assets/audio/ambient/action/02-tactical-breach-2.opus'),
  'mechanical-focus-1': require('../../../assets/audio/ambient/education/01-mechanical-focus-1.opus'),
  'mechanical-focus-2': require('../../../assets/audio/ambient/education/02-mechanical-focus-2.opus'),
  'laboratory-groove-1': require('../../../assets/audio/ambient/education/03-laboratory-groove-1.opus'),
  'laboratory-groove-2': require('../../../assets/audio/ambient/education/04-laboratory-groove-2.opus'),
} as const satisfies Record<string, number>;

export type AmbientBedSlug = keyof typeof AMBIENT_BED_SOURCES;
