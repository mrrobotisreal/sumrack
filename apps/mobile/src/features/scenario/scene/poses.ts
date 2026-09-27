/**
 * Pose recipes (T61, §8.1 item 6) — pure targets + timing constants. The
 * components turn these into reanimated shared values through the T31
 * `useAmbientValue` (loops) and `withTiming` (settles); under reduce-motion
 * every target is the neutral poster and the loops never start. Only the
 * mouth is exempt (it is information, not decoration).
 */

export type ScenePose = 'idle' | 'speaking' | 'listening' | 'thinking';

export const SCENE_POSES: readonly ScenePose[] = ['idle', 'speaking', 'listening', 'thinking'];

/** Breathing: ±2 px / 1.00–1.012 over 3.6 s. */
export const BREATH_PERIOD_MS = 3600;
export const BREATH_TRANSLATE_PX = 2;
export const BREATH_SCALE_MAX = 1.012;

/** Speaking: a slow-sine head tilt of ±1.5° (1–2° band) and the glow +10 %. */
export const TILT_PERIOD_MS = 2600;
export const TILT_DEGREES = 1.5;
export const SPEAKING_GLOW_BOOST = 0.1;

/** Listening: lean 6 px toward the mic (screen-left, where the mic button sits) + brow lift. */
export const LISTEN_LEAN_PX = -6;
export const LISTEN_BROW_LIFT_PX = -4;

/** Thinking: eyes up-left (placeholder only). */
export const THINK_GAZE_X = -3;
export const THINK_GAZE_Y = -4;

/** Pose settles (lean, brow, gaze, glow) ease over this. */
export const POSE_SETTLE_MS = 320;

/** Blink: opacity 0→1→0 over 120 ms every 2.8–6 s. */
export const BLINK_MS = 120;
export const BLINK_GAP_MIN_MS = 2800;
export const BLINK_GAP_MAX_MS = 6000;
/** An irregular gap sequence inside the band — the UI-thread loop cycles it. */
export const BLINK_GAPS_MS: readonly number[] = [3400, 5100, 2900, 4300, 5900, 3700];

export interface PoseTargets {
  /** Head-group translateX (px). */
  leanX: number;
  /** Brow layer translateY (px). */
  browLift: number;
  /** Iris layer translate (px). */
  gazeX: number;
  gazeY: number;
  /** Multiplier on the host glow's opacity. */
  glow: number;
  /** Whether the tilt loop runs. */
  tilt: boolean;
  /** Whether the breathing loop runs. */
  breathe: boolean;
}

export const NEUTRAL_TARGETS: PoseTargets = {
  leanX: 0,
  browLift: 0,
  gazeX: 0,
  gazeY: 0,
  glow: 1,
  tilt: false,
  breathe: false,
};

/**
 * Static targets for a pose. `reduceMotion` freezes everything on the
 * neutral poster (the mouth is driven elsewhere). `png` art has no brow or
 * iris layers, so those targets stay neutral for it (tilt + glow only).
 */
export function poseTargets(
  pose: ScenePose,
  opts: { reduceMotion: boolean; png: boolean },
): PoseTargets {
  if (opts.reduceMotion) return NEUTRAL_TARGETS;
  const base: PoseTargets = { ...NEUTRAL_TARGETS, breathe: true };
  switch (pose) {
    case 'idle':
      return base;
    case 'speaking':
      return { ...base, glow: 1 + SPEAKING_GLOW_BOOST, tilt: true };
    case 'listening':
      return { ...base, leanX: LISTEN_LEAN_PX, browLift: opts.png ? 0 : LISTEN_BROW_LIFT_PX };
    case 'thinking':
      return { ...base, gazeX: opts.png ? 0 : THINK_GAZE_X, gazeY: opts.png ? 0 : THINK_GAZE_Y };
  }
}
