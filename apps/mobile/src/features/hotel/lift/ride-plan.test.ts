import { describe, expect, it } from 'vitest';

import {
  crossesMissing13,
  downLit,
  floorAbove,
  floorBelow,
  markerState,
  planRide,
  upLit,
} from './ride-plan';

/** The panel with 13 hidden (D5). */
const PANEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];
/** The panel once Номер 13 is revealed. */
const PANEL_13 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

describe('planRide: plain rides', () => {
  it('goes up one floor with a single step and the base duration', () => {
    expect(planRide(PANEL, 3, 4)).toEqual({ steps: [4], passes13: false, durationMs: 900 });
  });

  it('goes down one floor', () => {
    expect(planRide(PANEL, 4, 3)).toEqual({ steps: [3], passes13: false, durationMs: 900 });
  });

  it('visits every panel floor between the ends, in travel order', () => {
    const plan = planRide(PANEL, 1, 4);
    expect(plan.steps).toEqual([2, 3, 4]);
    // Two floors are passed before arriving at 4 (2 and 3), so 900 + 2×120.
    expect(plan.durationMs).toBe(1140);
  });

  it('visits every panel floor going down', () => {
    expect(planRide(PANEL, 4, 1).steps).toEqual([3, 2, 1]);
  });

  it('a ride to the current floor has no steps and no duration', () => {
    expect(planRide(PANEL, 5, 5)).toEqual({ steps: [], passes13: false, durationMs: 0 });
  });
});

describe('planRide: the missing 13', () => {
  it('a 12 → 14 ride passes 13 and flags it', () => {
    const plan = planRide(PANEL, 12, 14);
    expect(plan.steps).toEqual([14]);
    expect(plan.passes13).toBe(true);
    // One physical floor passed (13), so 900 + 120.
    expect(plan.durationMs).toBe(1020);
  });

  it('a 14 → 12 ride passes 13 the other way and flags it', () => {
    const plan = planRide(PANEL, 14, 12);
    expect(plan.steps).toEqual([12]);
    expect(plan.passes13).toBe(true);
    expect(plan.durationMs).toBe(1020);
  });

  it('a long ride across the gap counts 13 as one more passed floor', () => {
    const plan = planRide(PANEL, 10, 15);
    expect(plan.steps).toEqual([11, 12, 14, 15]);
    expect(plan.passes13).toBe(true);
    // Passed before arriving: 11, 12, 14 plus the missing 13 = 4 → 900 + 480.
    expect(plan.durationMs).toBe(1380);
  });

  it('does not flag a crossing that never touches the gap', () => {
    expect(planRide(PANEL, 2, 9).passes13).toBe(false);
    expect(planRide(PANEL, 14, 15).passes13).toBe(false);
  });

  it('with 13 revealed the gap is a normal floor: no flicker, no extra time', () => {
    const plan = planRide(PANEL_13, 12, 14);
    expect(plan.steps).toEqual([13, 14]);
    expect(plan.passes13).toBe(false);
    expect(plan.durationMs).toBe(900 + 120);
  });

  it('crossesMissing13 is false when 13 is on the panel', () => {
    expect(crossesMissing13(PANEL_13, 12, 14)).toBe(false);
  });
});

describe('planRide: the cap', () => {
  it('caps the ride at 2400 ms on a long ride', () => {
    const big = Array.from({ length: 30 }, (_, i) => i);
    const plan = planRide(big, 0, 29);
    // 28 floors passed → 900 + 3360 would be over the cap.
    expect(plan.durationMs).toBe(2400);
  });

  it('stays under the cap below 12 floors passed and clamps at it beyond', () => {
    const big = Array.from({ length: 30 }, (_, i) => i);
    expect(planRide(big, 0, 12).durationMs).toBe(900 + 120 * 11);
    expect(planRide(big, 0, 14).durationMs).toBe(2400);
  });
});

describe('floor neighbours on the panel', () => {
  it('skips the missing 13 when looking up and down', () => {
    expect(floorAbove(PANEL, 12)).toBe(14);
    expect(floorBelow(PANEL, 14)).toBe(12);
  });

  it('returns null at the top and the bottom', () => {
    expect(floorAbove(PANEL, 15)).toBeNull();
    expect(floorBelow(PANEL, 0)).toBeNull();
  });

  it('throws for a floor that is not on the panel', () => {
    expect(() => floorAbove(PANEL, 13)).toThrow();
  });
});

describe('upLit: the dark ▲ on the highest unlocked floor', () => {
  it('is lit when the floor above is unlocked', () => {
    expect(upLit(PANEL, 3, 4)).toBe(true);
  });

  it('is dark on the highest unlocked floor (the floor above is locked)', () => {
    expect(upLit(PANEL, 4, 4)).toBe(false);
  });

  it('is dark when standing on the top of the panel', () => {
    expect(upLit(PANEL, 15, 15)).toBe(false);
  });

  it('is lit to the next floor across the gap only when 14 is unlocked', () => {
    expect(upLit(PANEL, 12, 12)).toBe(false);
    expect(upLit(PANEL, 12, 14)).toBe(true);
  });

  it('is lit from the starting floor 0 with floor 1 unlocked', () => {
    expect(upLit(PANEL, 0, 1)).toBe(true);
    expect(upLit(PANEL, 0, 0)).toBe(false);
  });
});

describe('downLit', () => {
  it('is lit whenever a lower floor exists on the panel', () => {
    expect(downLit(PANEL, 15)).toBe(true);
    expect(downLit(PANEL, 14)).toBe(true);
    expect(downLit(PANEL, 1)).toBe(true);
  });

  it('is dark only on the ground floor', () => {
    expect(downLit(PANEL, 0)).toBe(false);
  });
});

describe('markerState (T92d debrief markers)', () => {
  it('marks the current floor and the next floor in each direction, skipping the missing 13', () => {
    // At 12 the floor above on the panel is 14 (13 is hidden), below is 11.
    expect(markerState(PANEL, 12, [14])).toEqual({ here: false, up: true, down: false });
    expect(markerState(PANEL, 12, [12])).toEqual({ here: true, up: false, down: false });
    expect(markerState(PANEL, 5, [4, 6])).toEqual({ here: false, up: true, down: true });
  });

  it('has no marker on an edge or with nothing marked', () => {
    expect(markerState(PANEL, 15, [])).toEqual({ here: false, up: false, down: false });
    expect(markerState(PANEL, 0, [1])).toEqual({ here: false, up: true, down: false });
  });
});
