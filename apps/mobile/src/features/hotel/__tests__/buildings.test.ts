import { describe, expect, it } from 'vitest';

import { HOTEL_PROFILES } from '@/features/torfl/hotel-profile';

import {
  debriefFloors,
  gatePassedOf,
  gatePasses,
  hotelCardLine,
  markedFloors,
  nextHotelAction,
  passedFloorsOf,
  type GateAttemptLike,
} from '../gate-model';
import {
  duplicateFloors,
  floorState,
  highestUnlocked,
  panelFor,
  parseLastFloors,
  reveal13,
  startFloor,
  type FloorInput,
  type ProgressRow,
} from '../hotel-model';
import { lessonKey, lessonOpenedSet } from '../lesson/lesson-model';

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

describe('two buildings side by side (A1 floors 0–3 + A2 floors 0–3)', () => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fl = (level: 'A1' | 'A2', n: number): FloorInput => ({
    packId: `${level.toLowerCase()}-hotel-f${pad(n)}`,
    floor: n,
    unitIds: ['u1', 'u2'],
    hasExam: n !== 0,
    level,
  });
  const installed = [0, 1, 2, 3].flatMap((n) => [fl('A1', n), fl('A2', n)]);
  const row = (
    packId: string,
    unitId: string | null,
    via: 'course' | 'extern' = 'course',
  ): ProgressRow => ({
    key: `${packId}:${unitId ?? 'floor'}`,
    packId,
    unitId,
    bestPercent: 90,
    passedAt: 1,
    passedVia: unitId === null ? via : 'course',
    attempts: 1,
    lastAttemptAt: 1,
    cooldownUntil: null,
  });

  it('each building gets its own panel (no cross-building floors, no duplicates)', () => {
    expect(panelFor(installed, 'A1').map((f) => f.packId)).toEqual([
      'a1-hotel-f00',
      'a1-hotel-f01',
      'a1-hotel-f02',
      'a1-hotel-f03',
    ]);
    expect(panelFor(installed, 'A2').map((f) => f.packId)).toEqual([
      'a2-hotel-f00',
      'a2-hotel-f01',
      'a2-hotel-f02',
      'a2-hotel-f03',
    ]);
    expect(duplicateFloors(installed.filter((f) => f.level === 'A2'))).toEqual([]);
  });

  it('H3: a fresh A2 building opens floors 0 and 1 with A1 untouched; A1 progress never unlocks A2', () => {
    const a1Progress = [row('a1-hotel-f01', null), row('a1-hotel-f02', null)];
    const a2 = floorState(installed, a1Progress, 0, 'A2');
    expect(a2.map((s) => [s.floor, s.unlocked, s.passed])).toEqual([
      [0, true, false],
      [1, true, false],
      [2, false, false],
      [3, false, false],
    ]);
    const a1 = floorState(installed, a1Progress, 0, 'A1');
    expect(a1.map((s) => s.unlocked)).toEqual([true, true, true, true]);
  });

  it('the экстерн cascade stays inside its building', () => {
    const progress = [row('a2-hotel-f03', null, 'extern')];
    const a2 = floorState(installed, progress, 0, 'A2');
    expect(a2.map((s) => [s.floor, s.passed, s.passedVia])).toEqual([
      [0, true, 'extern'],
      [1, true, 'extern'],
      [2, true, 'extern'],
      [3, true, 'extern'],
    ]);
    const a1 = floorState(installed, progress, 0, 'A1');
    expect(a1.map((s) => s.passed)).toEqual([false, false, false, false]);
    expect(highestUnlocked(a1)).toBe(1);
  });

  it('the last floor is saved per building; the legacy single number is A1’s', () => {
    expect(parseLastFloors(7)).toEqual({ A1: 7 });
    expect(parseLastFloors({ A1: 3, A2: 1 })).toEqual({ A1: 3, A2: 1 });
    expect(parseLastFloors({ A2: 13.5, B1: 4, A1: -1 })).toEqual({});
    expect(parseLastFloors('7')).toEqual({});
    expect(parseLastFloors(null)).toEqual({});
    const panelA2 = panelFor(installed, 'A2').map((f) => f.floor);
    expect(startFloor(panelA2, parseLastFloors({ A1: 3 }).A2 ?? null)).toBe(0);
    expect(startFloor(panelA2, parseLastFloors({ A1: 3, A2: 2 }).A2 ?? null)).toBe(2);
  });

  it('lesson-opened sets are per floor and per building', () => {
    const opened = lessonOpenedSet({ [lessonKey('a2-hotel-f01', 'u1')]: 3 });
    expect(opened.has(lessonKey('a2-hotel-f01', 'u1'))).toBe(true);
    expect(opened.has(lessonKey('a1-hotel-f01', 'u1'))).toBe(false);
  });

  it('debrief markers: each building’s topic map, cleared only by its own floors', () => {
    const missed = [
      { itemId: 'i1', topic: 'case-gen' },
      { itemId: 'i2', topic: 'case-plural' },
      { itemId: 'i3', topic: 'verb-aspect' },
    ];
    // A1: case-gen → 6, verb-aspect → 5 (case-plural is not an A1 topic).
    expect(debriefFloors(missed, 'A1')).toEqual([5, 6]);
    // A2: case-gen → 3, case-plural → 1, verb-aspect → 6.
    expect(debriefFloors(missed, 'A2')).toEqual([1, 3, 6]);
    const a2Debrief = [{ floors: debriefFloors(missed, 'A2') }];
    const progress = [row('a1-hotel-f01', null), row('a1-hotel-f03', null)];
    // A1 floors 1 and 3 passed: the A2 markers on 1 and 3 stay lit.
    const a2Passed = passedFloorsOf(progress, panelFor(installed, 'A2'));
    expect(markedFloors(a2Debrief, a2Passed)).toEqual([1, 3, 6]);
    // A2 floor 3 passed: only A2's marker on 3 clears.
    const a2Passed2 = passedFloorsOf([row('a2-hotel-f03', null)], panelFor(installed, 'A2'));
    expect(markedFloors(a2Debrief, a2Passed2)).toEqual([1, 6]);
  });

  it('Номер 13 reveals per building: its own floor 15 passed AND its own gate pack installed', () => {
    const with15 = [...installed, fl('A1', 15), fl('A2', 15)];
    const a1Done = [row('a1-hotel-f15', null, 'extern')];
    expect(reveal13(with15, a1Done, { mockInstalled: true, level: 'A1' })).toBe(true);
    expect(reveal13(with15, a1Done, { mockInstalled: true, level: 'A2' })).toBe(false);
    const a2Done = [row('a2-hotel-f15', null, 'extern')];
    expect(reveal13(with15, a2Done, { mockInstalled: false, level: 'A2' })).toBe(false);
    expect(reveal13(with15, a2Done, { mockInstalled: true, level: 'A2' })).toBe(true);
  });

  it('A1-only install behaves exactly as before when no building is named', () => {
    const a1Only = [0, 1, 2, 3].map((n) => ({ ...fl('A1', n), level: undefined }));
    const progress = [row('a1-hotel-f01', null)];
    expect(floorState(a1Only, progress, 0)).toEqual(floorState(a1Only, progress, 0, 'A1'));
    expect(panelFor(a1Only).map((f) => f.floor)).toEqual([0, 1, 2, 3]);
  });
});

describe('Today labels per building (H7)', () => {
  const lesson = nextHotelAction(
    [
      {
        packId: 'a2-hotel-f06',
        floor: 6,
        unlocked: true,
        passed: false,
        units: [{ unitId: 'u1', title: 'Вид', passed: false, lessonOpened: false }],
        examCooldownMinutes: null,
        examUnlocked: false,
      },
    ],
    { gatePassed: false, reveal13: false, level: 'A2' },
  )!;

  it('names the A2 building first, and leaves the A1 line as it was', () => {
    expect(hotelCardLine(lesson, 'A2')).toBe('А2 · Этаж 6 · Вид · урок 1 из 1');
    expect(hotelCardLine(lesson, 'A1')).toBe('Этаж 6 · Вид · урок 1 из 1');
    expect(hotelCardLine(lesson)).toBe('Этаж 6 · Вид · урок 1 из 1');
  });

  it('the «пройден ✓» line is the building’s own', () => {
    expect(nextHotelAction([], { gatePassed: true, reveal13: true, level: 'A2' })).toMatchObject({
      label: 'A2 пройден ✓',
    });
    expect(nextHotelAction([], { gatePassed: true, reveal13: true, level: 'A1' })).toMatchObject({
      label: 'A1 пройден ✓',
    });
  });

  it('the A2 room’s SPbU rule uses the A2 profile thresholds (66 / 60)', () => {
    const r = (percent: number) => ({ kind: 'lexgram', percent });
    expect(gatePasses([r(66), r(61), r(70)], 'A2')).toBe(true);
    expect(gatePasses([r(65), r(61), r(70)], 'A2')).toBe(false);
    expect(gatePasses([r(59), r(70), r(70)], 'A2')).toBe(false);
  });
});
