/**
 * T91 lift clips (assets/audio/hotel/). Split out of `lift-sfx.ts` (ISS-005)
 * so unit tests can `vi.mock` this module, as `ambient-audio/sources.ts` does:
 * vitest would otherwise try to parse the Opus bytes as JavaScript.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export const LIFT_SFX_SOURCES = {
  close: require('../../../../assets/audio/hotel/lift-close.opus') as number,
  ride: require('../../../../assets/audio/hotel/lift-ride.opus') as number,
  ding: require('../../../../assets/audio/hotel/lift-ding.opus') as number,
  open: require('../../../../assets/audio/hotel/lift-open.opus') as number,
  flicker: require('../../../../assets/audio/hotel/flicker.opus') as number,
  drop: require('../../../../assets/audio/hotel/drop.opus') as number,
  blocked: require('../../../../assets/audio/hotel/lift-blocked.opus') as number,
} as const;
