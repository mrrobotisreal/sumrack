import { describe, expect, it } from 'vitest';

import {
  cooldownLeft,
  debriefFloors,
  debriefForSubtests,
  floorForTopic,
  formatCooldownRu,
  gateCooldownUntil,
  gatePasses,
  GATE_PACK_ID,
  hotelCardLine,
  nextHotelAction,
  isHiddenGatePack,
  markedFloors,
  missedByKind,
  roomStatus,
  visiblePacks,
} from '../gate-model';

const HOUR = 60 * 60_000;
const MIN = 60_000;

describe('isHiddenGatePack (D16)', () => {
  const gate = { packId: GATE_PACK_ID, tags: ['torfl:gate', 'torfl'] };
  const drill = { packId: 'a1-torfl-drill-001', tags: ['torfl'] };

  it('hides the gate mock until it has been attempted', () => {
    expect(isHiddenGatePack(gate, false)).toBe(true);
    expect(isHiddenGatePack(gate, true)).toBe(false);
  });

  it('never hides a pack without the gate tag', () => {
    expect(isHiddenGatePack(drill, false)).toBe(false);
  });

  it('visiblePacks filters every listing through the same rule', () => {
    expect(visiblePacks([gate, drill], new Set())).toEqual([drill]);
    expect(visiblePacks([gate, drill], new Set([GATE_PACK_ID]))).toEqual([gate, drill]);
  });
});

describe('floorForTopic / debriefFloors (D6)', () => {
  it('maps every listed lexgram topic to its floor', () => {
    expect(floorForTopic('case-prep')).toBe(3);
    expect(floorForTopic('verb-aspect')).toBe(5);
    expect(floorForTopic('conj')).toBe(10);
    expect(floorForTopic('agr')).toBe(1);
    expect(floorForTopic('verb-forms')).toBe(2);
  });

  it('maps the skill subtests to 12, 14, 15 and lex-* to 11', () => {
    expect(floorForTopic('writing')).toBe(12);
    expect(floorForTopic('listening')).toBe(14);
    expect(floorForTopic('speaking')).toBe(15);
    expect(floorForTopic('lex-anything')).toBe(11);
  });

  it('returns null for an unknown topic instead of guessing', () => {
    expect(floorForTopic('mystery')).toBeNull();
  });

  it('orders floors by miss count, then floor number, ignoring unknown topics', () => {
    const missed = [
      { itemId: 'a', topic: 'case-acc' },
      { itemId: 'b', topic: 'case-prep' },
      { itemId: 'c', topic: 'case-prep' },
      { itemId: 'd', topic: 'mystery' },
      { itemId: 'e', topic: 'agr' },
    ];
    expect(debriefFloors(missed)).toEqual([3, 1, 4]);
  });
});

describe('gatePasses (SPbU rule, D6/D13)', () => {
  const r = (percent: number) => ({ kind: 'k', percent });

  it('passes when every subtest is ≥ 66', () => {
    expect(gatePasses([r(66), r(70), r(90)])).toBe(true);
  });

  it('allows exactly one subtest in [60, 66)', () => {
    expect(gatePasses([r(60), r(70), r(70)])).toBe(true);
  });

  it('fails when two subtests are under 66', () => {
    expect(gatePasses([r(61), r(65), r(90)])).toBe(false);
  });

  it('fails when any subtest is under 60', () => {
    expect(gatePasses([r(59), r(90), r(90)])).toBe(false);
  });

  it('fails with no results', () => {
    expect(gatePasses([])).toBe(false);
  });
});

describe('debriefForSubtests', () => {
  it('lists only the subtests under 66 with their floors', () => {
    const out = debriefForSubtests(
      [
        { kind: 'lexgram', percent: 50 },
        { kind: 'writing', percent: 80 },
      ],
      { lexgram: [{ itemId: 'x', topic: 'case-dat' }] },
    );
    expect(out).toEqual([{ kind: 'lexgram', percent: 50, floors: [7] }]);
  });
});

describe('gate cooldown (D13, decision 6)', () => {
  it('is 6 h after a failed gate, measured from the finish time', () => {
    expect(gateCooldownUntil(1_000, false)).toBe(1_000 + 6 * HOUR);
  });

  it('never cools down after a pass or with no attempt', () => {
    expect(gateCooldownUntil(1_000, true)).toBeNull();
    expect(gateCooldownUntil(null, false)).toBeNull();
  });

  it('reports whole minutes left rounded up, and null once it has passed', () => {
    const now = 0;
    expect(cooldownLeft(6 * HOUR, now)?.minutesLeft).toBe(360);
    expect(cooldownLeft(MIN + 1, now)?.minutesLeft).toBe(2);
    expect(cooldownLeft(5 * MIN, 5 * MIN)).toBeNull();
    expect(cooldownLeft(null, now)).toBeNull();
  });

  it('formats the Russian countdown line', () => {
    expect(formatCooldownRu(342)).toBe('5 ч 42 мин');
    expect(formatCooldownRu(120)).toBe('2 ч');
    expect(formatCooldownRu(42)).toBe('42 мин');
  });
});

describe('ladderLevel (D18)', () => {
  it('is A1 until the gate passes, then A2', async () => {
    const { ladderLevel } = await import('../gate-model');
    expect(ladderLevel(false)).toBe('A1');
    expect(ladderLevel(true)).toBe('A2');
  });
});

describe('nextHotelAction (Today card, D18)', () => {
  const unit = (unitId: string, passed: boolean, lessonOpened: boolean) => ({
    unitId,
    title: `T ${unitId}`,
    passed,
    lessonOpened,
  });
  const floor = (
    n: number,
    units: ReturnType<typeof unit>[],
    extra: Partial<{
      unlocked: boolean;
      passed: boolean;
      examUnlocked: boolean;
      examCooldownMinutes: number | null;
    }> = {},
  ) => ({
    packId: `a1-hotel-f${String(n).padStart(2, '0')}`,
    floor: n,
    unlocked: true,
    passed: false,
    units,
    examCooldownMinutes: null,
    examUnlocked: false,
    ...extra,
  });
  const none = { gatePassed: false, reveal13: false };

  it('points at a never-opened unit lesson first', () => {
    const a = nextHotelAction(
      [floor(0, [unit('u1', false, false), unit('u2', false, false)])],
      none,
    );
    expect(a).toMatchObject({ kind: 'lesson', floor: 0, unitId: 'u1', index: 1, total: 2 });
    expect(a?.kind === 'lesson' && a.route).toBe('/hotel/a1-hotel-f00/u1');
  });

  it('points at the exercises once the lesson was opened', () => {
    const a = nextHotelAction([floor(6, [unit('u1', false, true)])], none);
    expect(a).toMatchObject({ kind: 'exercises', floor: 6, unitId: 'u1' });
  });

  it('falls to the floor exam when every unit passed', () => {
    const a = nextHotelAction(
      [floor(6, [unit('u1', true, true)], { examUnlocked: true, examCooldownMinutes: 12 })],
      none,
    );
    expect(a).toMatchObject({ kind: 'exam', floor: 6, cooldownMinutes: 12 });
    expect(hotelCardLine(a!)).toBe('Экзамен этажа 6 · через 12 мин');
  });

  it('skips locked and passed floors', () => {
    const a = nextHotelAction(
      [
        floor(0, [unit('u1', true, true)], { passed: true }),
        floor(1, [unit('u1', false, false)], { unlocked: false }),
      ],
      none,
    );
    expect(a).toBeNull();
  });

  it('says Номер 13 waits, then A1 пройден when the gate passes', () => {
    expect(nextHotelAction([], { gatePassed: false, reveal13: true })).toMatchObject({
      kind: 'done-all',
      label: 'Номер 13 ждёт',
    });
    expect(nextHotelAction([], { gatePassed: true, reveal13: true })).toMatchObject({
      kind: 'done-all',
      label: 'A1 пройден ✓',
    });
  });

  it('formats the card line with floor, unit and position', () => {
    const a = nextHotelAction(
      [floor(6, [unit('u1', false, false), unit('u2', false, false)])],
      none,
    );
    expect(hotelCardLine(a!)).toBe('Этаж 6 · T u1 · урок 1 из 2');
  });
});

describe('markers (T92c D6): floors to retake after a gate fail', () => {
  it('marks the debrief floors until their floor exam is retaken', () => {
    const debrief = [
      { kind: 'lexgram', percent: 50, floors: [7, 4] },
      { kind: 'writing', percent: 60, floors: [12] },
    ];
    expect(markedFloors(debrief, new Set())).toEqual([4, 7, 12]);
  });

  it('clears a marker once that floor exam is passed', () => {
    const debrief = [{ kind: 'lexgram', percent: 50, floors: [7, 4] }];
    expect(markedFloors(debrief, new Set([4]))).toEqual([7]);
  });

  it('is empty when there is no debrief', () => {
    expect(markedFloors([], new Set())).toEqual([]);
  });
});

describe('room 13 model (T92c D6)', () => {
  it('reports the gate open when there is no attempt', () => {
    expect(roomStatus({ verdict: null, lastFinishedAt: null, now: 0 })).toEqual({
      kind: 'open',
    });
  });

  it('reports a pass as passed (steady gold, no cooldown)', () => {
    expect(roomStatus({ verdict: 'pass', lastFinishedAt: 1_000, now: 2_000 })).toEqual({
      kind: 'passed',
    });
  });

  it('reports a fail as cooling until 6 h after the finished attempt', () => {
    const finishedAt = 1_000_000;
    const status = roomStatus({
      verdict: 'fail',
      lastFinishedAt: finishedAt,
      now: finishedAt + HOUR,
    });
    expect(status).toEqual({
      kind: 'cooling',
      until: finishedAt + 6 * HOUR,
      left: { minutesLeft: 300, text: '5 ч' },
    });
  });

  it('reopens the gate once the cooldown has passed', () => {
    const finishedAt = 1_000_000;
    expect(
      roomStatus({ verdict: 'fail', lastFinishedAt: finishedAt, now: finishedAt + 6 * HOUR }),
    ).toEqual({ kind: 'open' });
  });
});

describe('missedByKind (T92c D6): the debrief input', () => {
  it('groups the items a gate attempt missed by subtest kind', () => {
    const out = missedByKind([
      { itemId: 'a', subtestKind: 'lexgram', topic: 'case-dat', points: 0, maxPoints: 1 },
      { itemId: 'b', subtestKind: 'lexgram', topic: 'case-acc', points: 1, maxPoints: 1 },
      { itemId: 'c', subtestKind: 'writing', topic: 'writing', points: 2, maxPoints: 5 },
    ]);
    expect(out).toEqual({
      lexgram: [{ itemId: 'a', topic: 'case-dat' }],
      writing: [{ itemId: 'c', topic: 'writing' }],
    });
  });
});
