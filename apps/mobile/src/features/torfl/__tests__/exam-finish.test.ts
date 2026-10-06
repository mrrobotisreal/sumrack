import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import { initialRunState, reduce, type ExamRunState } from '../engine/exam-machine';
import { computeFinish } from '../engine/finish';
import { dictionaryAllowed, devDurationOverrideSec, formatClock, timerTone } from '../engine/rules';
import type { ExamAnswer } from '../model';
import { DEFAULT_TORFL_PREFS } from '../settings-core';

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const T0 = 1_790_000_000_000;
const choice = (index: number | null): ExamAnswer => ({ kind: 'choice', index });

function submitted(ids: string[]): ExamRunState {
  let state = initialRunState(EXAM, ids);
  const ctx = { exam: EXAM, breakBetween: false };
  state = reduce(ctx, state, { type: 'START', now: T0 }).state;
  for (let i = 0; i < ids.length; i++) {
    if (state.phase === 'instructions')
      state = reduce(ctx, state, { type: 'BEGIN', now: T0 }).state;
    state = reduce(ctx, state, { type: 'SUBMIT_SUBTEST', now: T0 + 1000 }).state;
  }
  return state;
}

describe('computeFinish', () => {
  it('scores lexgram: 5 items × 1, answers right/wrong/blank; pct over maxPoints 5', () => {
    const lex = EXAM.subtests.find((s) => s.id === 'lexgram')!;
    const items = lex.parts.flatMap((p) => p.items);
    const answers: Record<string, ExamAnswer> = {};
    // first two right, third wrong, fourth blank-choice, fifth absent
    for (const [i, item] of items.entries()) {
      if (item.kind !== 'choice') continue;
      if (i < 2) answers[item.id] = choice(item.answer);
      else if (i === 2) answers[item.id] = choice((item.answer + 1) % item.options.length);
      else if (i === 3) answers[item.id] = choice(null);
    }
    const f = computeFinish(EXAM, submitted(['lexgram']), answers, 'subtest');
    expect(f.results.lexgram).toEqual({
      points: 2,
      maxPoints: 5,
      pct: 40,
      provisional: false,
      gradedBy: 'offline',
    });
    expect(f.verdict).toBeNull();
    expect(f.missed.map((m) => [m.itemId, m.outcome])).toEqual([
      ['lg03', 'wrong'],
      ['lg04', 'blank'],
      ['lg05', 'blank'],
    ]);
  });

  it('a full mock with writing + speaking skipped: three results, NO verdict, skipped excluded (not 0 %)', () => {
    const all = EXAM.subtests.map((s) => s.id);
    const answers: Record<string, ExamAnswer> = {};
    for (const s of EXAM.subtests) {
      if (!['lexgram', 'reading', 'listening'].includes(s.kind)) continue;
      for (const item of s.parts.flatMap((p) => p.items)) {
        if (item.kind === 'choice') answers[item.id] = choice(item.answer);
      }
    }
    const f = computeFinish(EXAM, submitted(all), answers, 'full');
    expect(Object.keys(f.results).sort()).toEqual(['listening', 'lexgram', 'reading'].sort());
    expect(f.pcts).toEqual({ lexgram: 100, reading: 100, listening: 100 });
    expect(f.verdict?.verdict).toBeNull();
    expect(f.verdict?.missing).toEqual(['writing', 'speaking']);
    expect(f.missed).toEqual([]);
  });

  it('an unsubmitted subtest is not scored', () => {
    const f = computeFinish(EXAM, initialRunState(EXAM, ['lexgram']), {}, 'subtest');
    expect(f.results).toEqual({});
  });
});

describe('dictionary rule', () => {
  const on = DEFAULT_TORFL_PREFS;
  const off = { ...DEFAULT_TORFL_PREFS, allowLookupInMockReading: false };
  it('lookup only where the paper dictionary is allowed AND the pref is on', () => {
    expect(dictionaryAllowed({ dictionary: true }, on)).toBe(true);
    expect(dictionaryAllowed({ dictionary: true }, off)).toBe(false);
    expect(dictionaryAllowed({ dictionary: false }, on)).toBe(false);
  });
  it('mapping over the fixture: reading yes; lexgram + listening no', () => {
    const by = (id: string) =>
      dictionaryAllowed(
        EXAM.subtests.find((s) => s.id === id)!,
        on,
      );
    expect([by('reading'), by('lexgram'), by('listening')]).toEqual([true, false, false]);
  });
});

describe('dev duration override never reaches release', () => {
  it('release (__DEV__ false) ignores any value; dev honours valid whole seconds only', () => {
    expect(devDurationOverrideSec('60', false)).toBeUndefined();
    expect(devDurationOverrideSec('60', true)).toBe(60);
    expect(devDurationOverrideSec('4', true)).toBeUndefined();
    expect(devDurationOverrideSec('abc', true)).toBeUndefined();
    expect(devDurationOverrideSec('9999', true)).toBeUndefined();
    expect(devDurationOverrideSec(undefined, true)).toBeUndefined();
  });
});

describe('timer', () => {
  it('formats mm:ss rounding up, never negative', () => {
    expect(formatClock(40 * 60_000)).toBe('40:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(-5)).toBe('00:00');
  });
  it('amber at ≤ 5:00, red at ≤ 1:00', () => {
    expect(timerTone(300_001)).toBe('normal');
    expect(timerTone(300_000)).toBe('amber');
    expect(timerTone(60_001)).toBe('amber');
    expect(timerTone(60_000)).toBe('red');
  });
});
