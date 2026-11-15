import { describe, expect, it } from 'vitest';

import { HOTEL_PROFILES } from '@/features/torfl/hotel-profile';

import { gatePassedOf, type GateAttemptLike } from '../gate-model';
import { duplicateFloors, panelFor } from '../hotel-model';

/**
 * T116 (HOTEL_PATH_A2 §1–§2): two buildings side by side, and the three
 * audit bugs (H6). Bug 6a lives in `lesson/__tests__/lesson-model.test.ts`.
 */

const A1 = HOTEL_PROFILES.A1;
const A2 = HOTEL_PROFILES.A2;

function gateAttempt(over: Partial<GateAttemptLike> = {}): GateAttemptLike {
  return {
    packId: A1.gatePackId,
    examId: A1.gateExamId,
    status: 'finished',
    verdict: 'pass',
    finishedAt: 1_000,
    ...over,
  };
}

describe('bug 6b: gatePassed = the gate exam’s passing verdict in exam_attempts', () => {
  it('a finished passing attempt passes the gate, with no course_progress row at all', () => {
    expect(gatePassedOf([gateAttempt()], A1)).toBe(true);
    expect(gatePassedOf([gateAttempt({ verdict: 'pass-borderline' })], A1)).toBe(true);
  });

  it('a fail, an unfinished attempt or no attempt does not pass', () => {
    expect(gatePassedOf([], A1)).toBe(false);
    expect(gatePassedOf([gateAttempt({ verdict: 'fail' })], A1)).toBe(false);
    const active = gateAttempt({ status: 'active', verdict: null, finishedAt: null });
    expect(gatePassedOf([active], A1)).toBe(false);
  });

  it('the LATEST finished attempt decides (the room’s own status rule)', () => {
    const older = gateAttempt({ verdict: 'pass', finishedAt: 1_000 });
    const newer = gateAttempt({ verdict: 'fail', finishedAt: 2_000 });
    expect(gatePassedOf([older, newer], A1)).toBe(false);
    expect(gatePassedOf([newer, older], A1)).toBe(false);
    const repassed = gateAttempt({ verdict: 'pass', finishedAt: 3_000 });
    expect(gatePassedOf([older, newer, repassed], A1)).toBe(true);
  });

  it('only the building’s own gate exam counts', () => {
    const a2Pass = gateAttempt({ packId: A2.gatePackId, examId: A2.gateExamId });
    expect(gatePassedOf([a2Pass], A1)).toBe(false);
    expect(gatePassedOf([a2Pass], A2)).toBe(true);
    const otherExam = gateAttempt({ examId: 'a1-mock-03' });
    expect(gatePassedOf([otherExam], A1)).toBe(false);
  });
});

describe('bug 6c: a duplicate floor among the installed packs is picked deterministically', () => {
  const f3 = (packId: string, version: number) => ({
    packId,
    floor: 3,
    unitIds: ['u1'],
    hasExam: true,
    version,
  });

  it('the highest pack version wins, whatever the install order', () => {
    const old = f3('a1-hotel-f03', 1);
    const fork = f3('a1-hotel-f03-fork', 2);
    expect(panelFor([old, fork]).map((f) => f.packId)).toEqual(['a1-hotel-f03-fork']);
    expect(panelFor([fork, old]).map((f) => f.packId)).toEqual(['a1-hotel-f03-fork']);
  });

  it('equal versions → the pack id that sorts first, whatever the install order', () => {
    const a = f3('a1-hotel-f03', 2);
    const b = f3('a1-hotel-f03-b', 2);
    expect(panelFor([a, b]).map((f) => f.packId)).toEqual(['a1-hotel-f03']);
    expect(panelFor([b, a]).map((f) => f.packId)).toEqual(['a1-hotel-f03']);
  });

  it('duplicateFloors reports every floor more than one pack claims (the warn / dev-db line)', () => {
    const installed = [
      f3('a1-hotel-f03', 1),
      f3('x-f03', 2),
      { ...f3('a1-hotel-f04', 1), floor: 4 },
    ];
    expect(duplicateFloors(installed)).toEqual([
      { floor: 3, packIds: ['a1-hotel-f03', 'x-f03'], picked: 'x-f03' },
    ]);
    expect(duplicateFloors([f3('a1-hotel-f03', 1)])).toEqual([]);
  });
});
