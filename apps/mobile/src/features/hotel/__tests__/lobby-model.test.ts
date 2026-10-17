import { describe, expect, it } from 'vitest';

import {
  drillBeforeAfter,
  drillPercent,
  EXTERN_CONFIRM,
  EXTERN_PASS_PERCENT,
  externMenu,
  firstUnitStart,
  floorState,
  parseLastFloor,
  startFloor,
  type FloorInput,
  type FloorState,
} from '../hotel-model';

const floor = (n: number, units = 1): FloorInput => ({
  packId: `a1-hotel-f${String(n).padStart(2, '0')}`,
  floor: n,
  unitIds: Array.from({ length: units }, (_, k) => `u${k + 1}`),
  hasExam: n !== 0,
});

describe('externMenu', () => {
  it('lists every locked floor with an exam, in panel order', () => {
    const installed = [floor(0), floor(1), floor(2), floor(3)];
    const states = floorState(installed, [], 0);
    expect(externMenu(states).map((s) => s.floor)).toEqual([1, 2, 3]);
  });

  it('never offers floor 0 and is empty when nothing is locked', () => {
    const installed = [floor(0), floor(1)];
    const progress = [
      {
        key: 'a1-hotel-f00:u1',
        packId: 'a1-hotel-f00',
        unitId: 'u1',
        bestPercent: 90,
        passedAt: 1,
        passedVia: 'course' as const,
        attempts: 1,
        lastAttemptAt: 1,
        cooldownUntil: null,
      },
      {
        key: 'a1-hotel-f01:floor',
        packId: 'a1-hotel-f01',
        unitId: null,
        bestPercent: 90,
        passedAt: 1,
        passedVia: 'course' as const,
        attempts: 1,
        lastAttemptAt: 1,
        cooldownUntil: null,
      },
    ];
    const states = floorState(installed, progress, 0);
    expect(externMenu(states)).toEqual([]);
  });
});

describe('extern confirm copy', () => {
  it('states the 90 % line, no hints, and the one-hour pause', () => {
    expect(EXTERN_PASS_PERCENT).toBe(90);
    expect(EXTERN_CONFIRM.body).toBe('90 %, без подсказок, при неудаче — пауза 1 час');
  });
});

describe('parseLastFloor', () => {
  it('accepts integers 0–99 only', () => {
    expect(parseLastFloor(0)).toBe(0);
    expect(parseLastFloor(14)).toBe(14);
    expect(parseLastFloor(99)).toBe(99);
    expect(parseLastFloor(100)).toBeNull();
    expect(parseLastFloor(-1)).toBeNull();
    expect(parseLastFloor(2.5)).toBeNull();
    expect(parseLastFloor('3')).toBeNull();
    expect(parseLastFloor(null)).toBeNull();
    expect(parseLastFloor(undefined)).toBeNull();
  });
});

describe('startFloor', () => {
  const panel = [0, 1, 2, 3, 4];
  it('opens on the saved floor when it is on the panel', () => {
    expect(startFloor(panel, 3)).toBe(3);
  });
  it('falls back to the first panel floor for a missing or off-panel save', () => {
    expect(startFloor(panel, null)).toBe(0);
    expect(startFloor(panel, 13)).toBe(0);
    expect(startFloor([2, 3], 9)).toBe(2);
  });
  it('is 0 for an empty panel', () => {
    expect(startFloor([], 5)).toBe(0);
  });
});

describe('drillPercent', () => {
  it('averages subtest pct values, rounded', () => {
    expect(drillPercent({ a: { pct: 60 }, b: { pct: 81 } })).toBe(71);
  });
  it('is null when unscored', () => {
    expect(drillPercent(null)).toBeNull();
    expect(drillPercent({})).toBeNull();
  });
});

describe('drillBeforeAfter', () => {
  const att = (startedAt: number, pct: number | null, finished = true) => ({
    startedAt,
    finishedAt: finished ? startedAt + 10 : null,
    results: pct === null ? null : { s: { pct } },
  });

  it('splits drill bests at the floor first unit attempt', () => {
    const attempts = [att(100, 40), att(200, 55), att(900, 70), att(1000, 85)];
    expect(drillBeforeAfter(attempts, 500)).toEqual({ before: 55, after: 85 });
  });

  it('has no after before the floor is started', () => {
    expect(drillBeforeAfter([att(100, 40)], null)).toEqual({ before: 40, after: null });
  });

  it('is null both ways with no scored drills', () => {
    expect(drillBeforeAfter([], 500)).toEqual({ before: null, after: null });
    expect(drillBeforeAfter([att(100, 60, false)], 500)).toEqual({ before: null, after: null });
    expect(drillBeforeAfter([att(900, null)], 500)).toEqual({ before: null, after: null });
  });
});

describe('firstUnitStart', () => {
  it('returns the earliest unit attempt for the pack, ignoring floor and other packs', () => {
    const attempts = [
      { packId: 'p1', unitId: null, startedAt: 10 },
      { packId: 'p1', unitId: 'u1', startedAt: 300 },
      { packId: 'p1', unitId: 'u2', startedAt: 200 },
      { packId: 'p2', unitId: 'u1', startedAt: 50 },
    ];
    expect(firstUnitStart(attempts, 'p1')).toBe(200);
  });
  it('is null when the pack has no unit attempt', () => {
    expect(firstUnitStart([{ packId: 'p1', unitId: null, startedAt: 1 }], 'p1')).toBeNull();
  });
});

// Type-only reference keeps the FloorState import honest for readers of this file.
export type _Shape = FloorState;
