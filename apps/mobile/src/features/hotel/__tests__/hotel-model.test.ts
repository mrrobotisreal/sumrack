import { describe, expect, it } from 'vitest';

import {
  PANEL_A1,
  canAttempt,
  cooldownFor,
  drawItems,
  floorState,
  highestUnlocked,
  panelFor,
  passes,
  reveal13,
  scoreAttempt,
  weakestUnit,
  type FloorInput,
  type ProgressRow,
} from '../hotel-model';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A floor fixture: `units` unit ids, optional exam. */
function floor(floorNo: number, units: string[] = ['u1', 'u2'], exam = true): FloorInput {
  return {
    packId: `a1-hotel-f${String(floorNo).padStart(2, '0')}`,
    floor: floorNo,
    unitIds: units,
    hasExam: exam,
  };
}

/** Every panel floor installed (the full A1 hotel). */
function allFloors(): FloorInput[] {
  return PANEL_A1.map((n) => floor(n, ['u1', 'u2'], n !== 0));
}

function passedUnit(packId: string, unitId: string, percent = 90): ProgressRow {
  return {
    key: `${packId}:${unitId}`,
    packId,
    unitId,
    bestPercent: percent,
    passedAt: 1,
    passedVia: 'course',
    attempts: 1,
    lastAttemptAt: 1,
    cooldownUntil: null,
  };
}

function passedFloor(packId: string, via: 'course' | 'extern' = 'course'): ProgressRow {
  return {
    key: `${packId}:floor`,
    packId,
    unitId: null,
    bestPercent: 85,
    passedAt: 1,
    passedVia: via,
    attempts: 1,
    lastAttemptAt: 1,
    cooldownUntil: null,
  };
}

function failedFloor(packId: string, cooldownUntil: number): ProgressRow {
  return {
    key: `${packId}:floor`,
    packId,
    unitId: null,
    bestPercent: 40,
    passedAt: null,
    passedVia: null,
    attempts: 1,
    lastAttemptAt: cooldownUntil - 20 * MIN,
    cooldownUntil,
  };
}

const pid = (n: number) => `a1-hotel-f${String(n).padStart(2, '0')}`;

describe('panel (D5: 0, 1–12, 14, 15 — no 13)', () => {
  it('PANEL_A1 is 0..12 then 14, 15', () => {
    expect(PANEL_A1).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]);
    expect(PANEL_A1).not.toContain(13);
  });

  it('panelFor keeps only the installed floors, in panel order', () => {
    const installed = [floor(15), floor(0), floor(14), floor(3)];
    expect(panelFor(installed).map((f) => f.floor)).toEqual([0, 3, 14, 15]);
  });

  it('panelFor ignores a floor 13 even if one were installed', () => {
    expect(panelFor([floor(12), floor(13), floor(14)]).map((f) => f.floor)).toEqual([12, 14]);
  });
});

describe('reveal13 (D5/D6: floor 15 passed AND mock-004 installed)', () => {
  it('false when floor 15 is not passed', () => {
    expect(reveal13(allFloors(), [], { mockInstalled: true })).toBe(false);
  });

  it('false when floor 15 is passed but the mock is not installed', () => {
    const progress = [passedFloor(pid(15))];
    expect(reveal13(allFloors(), progress, { mockInstalled: false })).toBe(false);
  });

  it('true when floor 15 passed and mock-004 installed', () => {
    const progress = [passedFloor(pid(15))];
    expect(reveal13(allFloors(), progress, { mockInstalled: true })).toBe(true);
  });

  it('a floor 15 passed via экстерн also counts', () => {
    const progress = [passedFloor(pid(15), 'extern')];
    expect(reveal13(allFloors(), progress, { mockInstalled: true })).toBe(true);
  });
});

describe('floorState: the lock rule (design §3, D12)', () => {
  it('floor 0 is always unlocked on a fresh install', () => {
    const states = floorState(allFloors(), [], 0);
    const f0 = states.find((s) => s.floor === 0)!;
    expect(f0.unlocked).toBe(true);
    expect(f0.passed).toBe(false);
  });

  it('a fresh install unlocks only floor 0; floor 1 stays locked', () => {
    const states = floorState(allFloors(), [], 0);
    expect(states.filter((s) => s.unlocked).map((s) => s.floor)).toEqual([0]);
  });

  it('floor n unlocks when the previous PANEL floor is passed', () => {
    const progress = [passedFloor(pid(0))];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.unlocked).toBe(true);
  });

  it('floor 14 is unlocked by floor 12 (the panel skips 13)', () => {
    const progress = [passedFloor(pid(12))];
    const f14 = floorState(allFloors(), progress, 0).find((s) => s.floor === 14)!;
    expect(f14.unlocked).toBe(true);
  });

  it('floor 15 is unlocked by floor 14', () => {
    const progress = [passedFloor(pid(14))];
    const f15 = floorState(allFloors(), progress, 0).find((s) => s.floor === 15)!;
    expect(f15.unlocked).toBe(true);
  });

  it('a floor does not unlock from a non-adjacent passed floor', () => {
    const progress = [passedFloor(pid(0))];
    const f2 = floorState(allFloors(), progress, 0).find((s) => s.floor === 2)!;
    expect(f2.unlocked).toBe(false);
  });

  it('a passed floor stays unlocked and passed', () => {
    const progress = [passedFloor(pid(0)), passedFloor(pid(1))];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.passed).toBe(true);
    expect(f1.unlocked).toBe(true);
  });

  it('extern cascade: an экстерн pass on floor n unlocks every floor ≤ n as passed via extern (D12)', () => {
    // Floor 4 passed via экстерн. Floors 1..3 were never passed, but the
    // cascade marks them passed (their floor rows) and everything up to 4.
    const progress = [passedFloor(pid(4), 'extern')];
    const states = floorState(allFloors(), progress, 0);
    for (const n of [0, 1, 2, 3, 4]) {
      const s = states.find((x) => x.floor === n)!;
      expect(s.passed).toBe(true);
    }
    expect(states.find((x) => x.floor === 3)!.passedVia).toBe('extern');
    // floor 4 itself keeps its own row's via
    expect(states.find((x) => x.floor === 4)!.passedVia).toBe('extern');
    // the next floor is unlocked by the cascade
    expect(states.find((x) => x.floor === 5)!.unlocked).toBe(true);
  });

  it('any floor ≥ n passed via экстерн unlocks n (the lock rule clause)', () => {
    // Floor 9 passed via экстерн; floor 5 never touched: unlocked by the rule.
    const progress = [passedFloor(pid(9), 'extern')];
    const f5 = floorState(allFloors(), progress, 0).find((s) => s.floor === 5)!;
    expect(f5.unlocked).toBe(true);
    expect(f5.passed).toBe(true);
  });

  it('extern cascade does not overwrite a floor already passed by its course exam', () => {
    const progress = [passedFloor(pid(2), 'course'), passedFloor(pid(4), 'extern')];
    const f2 = floorState(allFloors(), progress, 0).find((s) => s.floor === 2)!;
    expect(f2.passedVia).toBe('course');
  });

  it('units inside an unlocked floor unlock in order (unit k+1 after unit k passes)', () => {
    const progress = [passedFloor(pid(0)), passedUnit(pid(1), 'u1')];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.units[0]!.unlocked).toBe(true);
    expect(f1.units[0]!.passed).toBe(true);
    expect(f1.units[1]!.unlocked).toBe(true);
    expect(f1.units[1]!.passed).toBe(false);
  });

  it('the second unit is locked until the first passes', () => {
    const progress = [passedFloor(pid(0))];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.units[0]!.unlocked).toBe(true);
    expect(f1.units[1]!.unlocked).toBe(false);
  });

  it('units of a locked floor are all locked', () => {
    const f5 = floorState(allFloors(), [], 0).find((s) => s.floor === 5)!;
    expect(f5.units.every((u) => !u.unlocked)).toBe(true);
  });

  it('a floor passed via экстерн has all units unlocked (D12 cascade: units below stay unpassed but unlocked)', () => {
    const progress = [passedFloor(pid(4), 'extern')];
    const f2 = floorState(allFloors(), progress, 0).find((s) => s.floor === 2)!;
    expect(f2.passed).toBe(true);
    expect(f2.units.every((u) => u.unlocked)).toBe(true);
    expect(f2.units.every((u) => !u.passed)).toBe(true);
  });

  it('the floor exam unlocks only when every unit passed', () => {
    const progress = [passedFloor(pid(0)), passedUnit(pid(1), 'u1'), passedUnit(pid(1), 'u2')];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.examUnlocked).toBe(true);
  });

  it('the floor exam stays locked while a unit is still unpassed', () => {
    const progress = [passedFloor(pid(0)), passedUnit(pid(1), 'u1')];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.examUnlocked).toBe(false);
  });

  it('floor 0 has no exam: it is passed when its last unit is passed', () => {
    const f0Units = ['u1', 'u2'];
    const hall = [floor(0, f0Units, false), floor(1)];
    const progress = [passedUnit(pid(0), 'u1'), passedUnit(pid(0), 'u2')];
    const f0 = floorState(hall, progress, 0).find((s) => s.floor === 0)!;
    expect(f0.passed).toBe(true);
    expect(f0.examUnlocked).toBe(false);
  });

  it('floor 0 is not passed while a unit is missing', () => {
    const hall = [floor(0, ['u1', 'u2'], false)];
    const progress = [passedUnit(pid(0), 'u1')];
    const f0 = floorState(hall, progress, 0).find((s) => s.floor === 0)!;
    expect(f0.passed).toBe(false);
  });

  it('a floor passed via its exam is passed with passedVia course and bestPercent carried', () => {
    const progress = [passedFloor(pid(0))];
    const f0 = floorState(allFloors(), progress, 0).find((s) => s.floor === 0)!;
    expect(f0.passedVia).toBe('course');
    expect(f0.bestPercent).toBe(85);
  });

  it('cooldownUntil is surfaced per floor from the floor progress row', () => {
    const progress = [passedFloor(pid(0)), failedFloor(pid(1), 5_000)];
    const f1 = floorState(allFloors(), progress, 1_000).find((s) => s.floor === 1)!;
    expect(f1.cooldownUntil).toBe(5_000);
  });

  it('an expired cooldown is reported as null', () => {
    const progress = [passedFloor(pid(0)), failedFloor(pid(1), 500)];
    const f1 = floorState(allFloors(), progress, 1_000).find((s) => s.floor === 1)!;
    expect(f1.cooldownUntil).toBeNull();
  });

  it('a unit row keeps its best percent', () => {
    const progress = [passedFloor(pid(0)), passedUnit(pid(1), 'u1', 85)];
    const f1 = floorState(allFloors(), progress, 0).find((s) => s.floor === 1)!;
    expect(f1.units[0]!.best).toBe(85);
  });

  it('a floor that is not installed is absent from the state list', () => {
    const states = floorState([floor(0), floor(1)], [], 0);
    expect(states.map((s) => s.floor)).toEqual([0, 1]);
  });
});

describe('highestUnlocked', () => {
  it('is the highest panel floor that is unlocked', () => {
    const progress = [passedFloor(pid(0)), passedFloor(pid(1)), passedFloor(pid(2))];
    expect(highestUnlocked(floorState(allFloors(), progress, 0))).toBe(3);
  });

  it('is 0 on a fresh install', () => {
    expect(highestUnlocked(floorState(allFloors(), [], 0))).toBe(0);
  });
});

describe('cooldownFor (D13): unit 0, floor 20 min, extern 60 min, gate 6 h; passes never cool down', () => {
  it('a unit fail has no cooldown', () => {
    expect(cooldownFor('unit', false)).toBe(0);
  });

  it('a floor fail cools down for 20 minutes', () => {
    expect(cooldownFor('floor', false)).toBe(20 * MIN);
  });

  it('an extern fail cools down for 60 minutes', () => {
    expect(cooldownFor('extern', false)).toBe(HOUR);
  });

  it('a gate fail cools down for 6 hours', () => {
    expect(cooldownFor('gate', false)).toBe(6 * HOUR);
  });

  it('a pass never cools down, for any kind', () => {
    for (const kind of ['unit', 'floor', 'extern', 'gate'] as const) {
      expect(cooldownFor(kind, true)).toBe(0);
    }
  });
});

describe('passes (D13): unit/floor ≥ 80, extern ≥ 90', () => {
  it('a unit passes at 80 and fails at 79.9', () => {
    expect(passes('unit', 80)).toBe(true);
    expect(passes('unit', 79.9)).toBe(false);
  });

  it('a floor passes at 80', () => {
    expect(passes('floor', 80)).toBe(true);
    expect(passes('floor', 79)).toBe(false);
  });

  it('an extern needs 90', () => {
    expect(passes('extern', 90)).toBe(true);
    expect(passes('extern', 89)).toBe(false);
  });
});

describe('canAttempt: cooldown is data (decision 6)', () => {
  it('allows an attempt with no progress row', () => {
    expect(canAttempt(undefined, 'floor', 0)).toEqual({ ok: true });
  });

  it('blocks a floor attempt inside its cooldown and reports minutes left', () => {
    const row = failedFloor(pid(1), 10 * MIN);
    expect(canAttempt(row, 'floor', 0)).toEqual({ ok: false, minutesLeft: 10 });
  });

  it('rounds the minutes left up', () => {
    const row = failedFloor(pid(1), 10 * MIN + 1);
    const res = canAttempt(row, 'floor', 0);
    expect(res).toEqual({ ok: false, minutesLeft: 11 });
  });

  it('allows once the cooldown has passed', () => {
    const row = failedFloor(pid(1), 10 * MIN);
    expect(canAttempt(row, 'floor', 10 * MIN)).toEqual({ ok: true });
  });

  it('a unit row never blocks (unit fails carry no cooldown)', () => {
    const row = failedFloor(pid(1), 99 * MIN);
    expect(canAttempt(row, 'unit', 0)).toEqual({ ok: true });
  });
});

describe('scoreAttempt (decision 5): choice/trigger exact, typed/transform via scoreTyped, writing/speaking pending', () => {
  const choice = {
    id: 'c1',
    topic: 'case',
    kind: 'choice' as const,
    stem: 'Я живу в …',
    stemEn: 'I live in …',
    options: ['большом', 'большой', 'большого', 'большую'],
    answer: 0,
    explain: 'x'.repeat(130),
  };
  const trigger = {
    id: 't1',
    topic: 'case',
    kind: 'trigger' as const,
    sentence: 'Я живу в большом городе.',
    tokens: ['Я', 'живу', 'в', 'большом', 'городе', '.'],
    answer: 2,
    explain: 'x'.repeat(130),
  };
  const typed = {
    id: 'ty1',
    topic: 'case',
    kind: 'typed' as const,
    stem: 'Я живу в Москв…',
    stemEn: 'I live in Moscow',
    accept: ['Москве'],
    explain: 'x'.repeat(130),
  };
  const transform = {
    id: 'tr1',
    topic: 'case',
    kind: 'transform' as const,
    prompt: 'Это мой брат. → У меня нет …',
    accept: ['брата'],
    half: ['брат'],
    explain: 'x'.repeat(130),
  };

  it('a correct choice scores full and a wrong one scores 0', () => {
    const items = [choice];
    expect(scoreAttempt(items as never, { c1: { answer: 0 } } as never)).toMatchObject({
      correct: 1,
      total: 1,
      percent: 100,
    });
    expect(scoreAttempt(items as never, { c1: { answer: 1 } } as never)).toMatchObject({
      correct: 0,
      total: 1,
      percent: 0,
    });
  });

  it('a trigger is exact on the token index', () => {
    const items = [trigger];
    expect(scoreAttempt(items as never, { t1: { answer: 2 } } as never).correct).toBe(1);
    expect(scoreAttempt(items as never, { t1: { answer: 3 } } as never).correct).toBe(0);
  });

  it('a typed answer goes through scoreTyped (ё/е fold, case, accepted forms)', () => {
    const items = [typed];
    expect(scoreAttempt(items as never, { ty1: { answer: 'москве' } } as never).correct).toBe(1);
    expect(scoreAttempt(items as never, { ty1: { answer: 'Москва' } } as never).correct).toBe(0);
  });

  it('a half-credit transform counts as 0.5 correct', () => {
    const items = [transform];
    const res = scoreAttempt(items as never, { tr1: { answer: 'брат' } } as never);
    expect(res.correct).toBe(0.5);
    expect(res.percent).toBe(50);
  });

  it('a transform full answer counts 1', () => {
    const items = [transform];
    expect(scoreAttempt(items as never, { tr1: { answer: 'брата' } } as never).correct).toBe(1);
  });

  it('an unanswered item counts as wrong, total still includes it', () => {
    const items = [choice, trigger];
    expect(scoreAttempt(items as never, { c1: { answer: 0 } } as never)).toMatchObject({
      correct: 1,
      total: 2,
      percent: 50,
    });
  });

  it('writing and speaking items are pending (graded in T92), not counted', () => {
    const writing = {
      id: 'w1',
      topic: 'writing',
      kind: 'writing' as const,
      prompt: 'Write',
      explain: 'x'.repeat(130),
    };
    const res = scoreAttempt([writing] as never, {} as never);
    expect(res.pending).toEqual(['w1']);
    expect(res.total).toBe(0);
    expect(res.percent).toBe(0);
  });

  it('a graded speaking turn (T93) counts by its stored judge verdict; ungraded stays pending', () => {
    const speaking = { id: 's1', topic: 'speak', kind: 'speaking-reply' as const, prompt: {} };
    const passed = scoreAttempt(
      [speaking] as never,
      {
        s1: { answer: { kind: 'speaking' }, correct: true },
      } as never,
    );
    expect(passed.pending).toEqual([]);
    expect(passed.percent).toBe(100);
    const failed = scoreAttempt(
      [speaking] as never,
      {
        s1: { answer: { kind: 'speaking' }, correct: false },
      } as never,
    );
    expect(failed.percent).toBe(0);
    expect(failed.pending).toEqual([]);
    expect(scoreAttempt([speaking] as never, {} as never).pending).toEqual(['s1']);
  });

  it('percent rounds to a whole number', () => {
    const items = [choice, trigger, typed];
    const res = scoreAttempt(items as never, { c1: { answer: 0 } } as never);
    expect(res.percent).toBe(Math.round((1 / 3) * 100));
  });
});

describe('drawItems (decision 5): deterministic for a seed; retries are fresh', () => {
  const pool = Array.from({ length: 20 }, (_, i) => `i${String(i).padStart(2, '0')}`);

  it('is deterministic for a given seed', () => {
    const a = drawItems(pool, 8, { missedLastTime: [], previous: [], seed: 42 });
    const b = drawItems(pool, 8, { missedLastTime: [], previous: [], seed: 42 });
    expect(a).toEqual(b);
  });

  it('a different seed gives a different order', () => {
    const a = drawItems(pool, 8, { missedLastTime: [], previous: [], seed: 1 });
    const b = drawItems(pool, 8, { missedLastTime: [], previous: [], seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('returns exactly size distinct ids from the pool', () => {
    const drawn = drawItems(pool, 8, { missedLastTime: [], previous: [], seed: 7 });
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn).size).toBe(8);
    for (const id of drawn) expect(pool).toContain(id);
  });

  it('puts missed items first, up to half of size', () => {
    const missed = ['i00', 'i01', 'i02', 'i03', 'i04', 'i05'];
    const drawn = drawItems(pool, 8, { missedLastTime: missed, previous: [], seed: 3 });
    const retried = drawn.filter((id) => missed.includes(id));
    // half of 8 = 4 at most from missed
    expect(retried.length).toBeLessThanOrEqual(4);
    expect(retried.length).toBe(4);
  });

  it('fills the rest from the pool, avoiding the previous attempt when possible', () => {
    const previous = pool.slice(0, 8);
    const drawn = drawItems(pool, 8, { missedLastTime: [], previous, seed: 5 });
    // the pool has 12 non-previous items, so no overlap is needed
    for (const id of drawn) expect(previous).not.toContain(id);
  });

  it('when the pool is too small to avoid the previous attempt, it still fills the size', () => {
    const small = pool.slice(0, 10);
    const previous = small.slice(0, 6);
    const drawn = drawItems(small, 8, { missedLastTime: [], previous, seed: 9 });
    expect(drawn).toHaveLength(8);
    expect(new Set(drawn).size).toBe(8);
  });

  it('a retry is never identical to the previous attempt when the pool allows (retry freshness)', () => {
    const previous = pool.slice(0, 8);
    const missed = previous.slice(0, 4);
    const drawn = drawItems(pool, 8, { missedLastTime: missed, previous, seed: 11 });
    expect(drawn.sort()).not.toEqual([...previous].sort());
  });

  it('a missed id absent from the pool is ignored', () => {
    const drawn = drawItems(pool, 8, {
      missedLastTime: ['ghost'],
      previous: [],
      seed: 4,
    });
    expect(drawn).not.toContain('ghost');
    expect(drawn).toHaveLength(8);
  });
});

describe('weakestUnit (decision 5): the unit whose items were missed most; ties → earlier unit', () => {
  const units = [
    { id: 'u1', items: ['a', 'b'] },
    { id: 'u2', items: ['c', 'd'] },
    { id: 'u3', items: ['e', 'f'] },
  ];

  it('picks the unit with the most misses', () => {
    const missed = ['a', 'c', 'd'];
    expect(weakestUnit(units, missed)).toBe('u2');
  });

  it('a tie goes to the earlier unit', () => {
    const missed = ['a', 'c'];
    expect(weakestUnit(units, missed)).toBe('u1');
  });

  it('returns null when nothing was missed', () => {
    expect(weakestUnit(units, [])).toBeNull();
  });
});

describe('reveal13 is independent of the panel order', () => {
  it('uses floor 15 specifically, not the highest panel floor', () => {
    const progress = [passedFloor(pid(14))];
    expect(reveal13(allFloors(), progress, { mockInstalled: true })).toBe(false);
  });
});
