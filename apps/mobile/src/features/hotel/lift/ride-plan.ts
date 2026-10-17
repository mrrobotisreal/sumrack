/**
 * T91 pure ride planner. No React, no Reanimated: the lift components and the
 * tests both read these numbers, so the animation maths is checked on its own.
 *
 * The panel is the ordered list of floors the car can stop at, e.g.
 * `[0,1,…,12,14,15]` (13 is absent) or `[0,…,15]` once Номер 13 is revealed.
 * Floors are compared by their position on the panel, never by number, so
 * the missing 13 is just a gap between 12 and 14.
 */

/** Ride timing (HOTEL_PATH D4 / T91 decision 5). */
export const RIDE_BASE_MS = 900;
export const RIDE_PER_FLOOR_MS = 120;
export const RIDE_CAP_MS = 2400;

/** The missing floor number (D5): the flicker fires when a ride crosses it. */
export const MISSING_FLOOR = 13;

export interface RidePlan {
  /** Floors the indicator stops on, in travel order; the last one is the destination. */
  steps: number[];
  /** True when the ride crosses the gap between 12 and 14 with 13 not on the panel. */
  passes13: boolean;
  /** Ride duration in ms: 900 + 120 per floor passed, capped at 2400. */
  durationMs: number;
}

function indexOf(panel: readonly number[], floor: number): number {
  const i = panel.indexOf(floor);
  if (i < 0) throw new Error(`floor ${floor} is not on the panel`);
  return i;
}

/** The floor directly above `floor` on the panel, or null on the top floor. */
export function floorAbove(panel: readonly number[], floor: number): number | null {
  const i = indexOf(panel, floor);
  return i + 1 < panel.length ? panel[i + 1]! : null;
}

/** The floor directly below `floor` on the panel, or null on the ground floor. */
export function floorBelow(panel: readonly number[], floor: number): number | null {
  const i = indexOf(panel, floor);
  return i > 0 ? panel[i - 1]! : null;
}

/**
 * ▲ is lit iff a floor exists above and it is unlocked (≤ highestUnlocked).
 * On the highest unlocked floor, or the top of the panel, it is dark.
 */
export function upLit(panel: readonly number[], floor: number, highestUnlocked: number): boolean {
  const above = floorAbove(panel, floor);
  return above !== null && above <= highestUnlocked;
}

/** ▼ is lit iff a lower floor exists on the panel. */
export function downLit(panel: readonly number[], floor: number): boolean {
  return floorBelow(panel, floor) !== null;
}

/** True when a ride between two panel floors crosses 12 ↔ 14 with 13 off the panel. */
export function crossesMissing13(panel: readonly number[], from: number, to: number): boolean {
  if (panel.includes(MISSING_FLOOR)) return false;
  const a = indexOf(panel, from);
  const b = indexOf(panel, to);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (let i = lo; i < hi; i++) {
    if (panel[i] === 12 && panel[i + 1] === 14) return true;
    if (panel[i] === 14 && panel[i + 1] === 12) return true;
  }
  return false;
}

/**
 * Plans a ride from `from` to `to` (both on the panel). Steps are the panel
 * floors after `from` up to and including `to`, in travel order. A ride to the
 * current floor has no steps and no duration.
 *
 * Floors passed = panel floors strictly between the two ends, plus the missing
 * 13 when the ride crosses the gap (it is physically passed).
 */
export function planRide(panel: readonly number[], from: number, to: number): RidePlan {
  const a = indexOf(panel, from);
  const b = indexOf(panel, to);
  if (a === b) return { steps: [], passes13: false, durationMs: 0 };
  const dir = b > a ? 1 : -1;
  const steps: number[] = [];
  for (let i = a + dir; dir > 0 ? i <= b : i >= b; i += dir) steps.push(panel[i]!);
  const passes13 = crossesMissing13(panel, from, to);
  const between = steps.length - 1;
  const passed = between + (passes13 ? 1 : 0);
  const durationMs = Math.min(RIDE_CAP_MS, RIDE_BASE_MS + RIDE_PER_FLOOR_MS * passed);
  return { steps, passes13, durationMs };
}

/**
 * Debrief markers (T92d): the lift's marker state for the indicator and the
 * ▲ / ▼ buttons. `here` = the current floor is marked; `up` / `down` = the next
 * floor in that direction is marked (the dot sits on that button).
 */
export function markerState(
  panel: readonly number[],
  floor: number,
  markers: readonly number[],
): { here: boolean; up: boolean; down: boolean } {
  const set = new Set(markers);
  const above = floorAbove(panel, floor);
  const below = floorBelow(panel, floor);
  return {
    here: set.has(floor),
    up: above !== null && set.has(above),
    down: below !== null && set.has(below),
  };
}
