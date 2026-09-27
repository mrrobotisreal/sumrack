/**
 * The `require()`d Opus assets behind the scene-bed registry, keyed by slug
 * (the M15 `sources.ts` split: vitest mocks this module; Metro needs every
 * path literal). Empty until room-tone masters land — see `beds.ts`.
 */

// When beds land: `/* eslint-disable @typescript-eslint/no-require-imports */`
// + `studio: require('../../../../assets/audio/scene/studio.opus')` per row.

export const SCENE_BED_SOURCES = {} as const satisfies Record<string, number>;

export type SceneBedSlug = keyof typeof SCENE_BED_SOURCES;
