/**
 * T91 drop timing (HOTEL_PATH D6). Pure constants and the digit sequence, so
 * the Lift and the tests share one source for the numbers.
 *
 * Normal motion: the lights stutter (3 dims over 400 ms), the cable snaps,
 * the indicator spins 15 → 14 → 13 at ~120 ms a digit, the screen shakes for
 * 900 ms (decaying), a 14 dp jolt at impact with a heavy haptic, 600 ms of
 * silence, then the doors creak open over 1100 ms.
 * Reduce-motion: no stutter, no spin, no shake, no jolt. A 400 ms fade to the
 * open doors. The sound and the haptic still play.
 */

export const DROP_STUTTER_MS = 400;
export const DROP_STUTTER_DIMS = 3;
export const DROP_SPIN_STEP_MS = 120;
export const DROP_SHAKE_MS = 900;
export const DROP_SHAKE_DP = 6;
export const DROP_JOLT_DP = 14;
export const DROP_SILENCE_MS = 600;
export const DROP_OPEN_MS = 1100;
export const DROP_REDUCED_FADE_MS = 400;

/** The digits the indicator passes on the way down: 15, 14, then 13 (the car lands on 13). */
export const DROP_DIGITS = ['15', '14', '13'] as const;

/** Total time from the press to the doors starting to open (no reduce-motion). */
export function dropLeadMs(): number {
  return DROP_STUTTER_MS + DROP_SPIN_STEP_MS * DROP_DIGITS.length + DROP_SILENCE_MS;
}

/**
 * Deterministic shake offset for the screen shake, decaying to zero over
 * DROP_SHAKE_MS. `t` is 0..1 progress through the shake. The noise is a
 * fixed sine mix, so the shake is repeatable and testable.
 */
export function shakeOffset(t: number): { x: number; y: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const decay = 1 - clamped;
  return {
    x: DROP_SHAKE_DP * decay * Math.sin(clamped * 47.1),
    y: DROP_SHAKE_DP * decay * Math.cos(clamped * 31.7),
  };
}
