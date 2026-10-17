import type { CourseItem } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  allowsExplainMore,
  allowsTranslation,
  examOutcome,
  isDeferredItem,
  isIdenticalDraw,
  servableItems,
  showsFeedback,
  unitOutcome,
  verdictOf,
} from '../runner-model';

const item = (id: string, kind: string) => ({ id, kind }) as unknown as CourseItem;

describe('deferred items (decision 9)', () => {
  it('serves choice, typed, trigger and transform', () => {
    for (const kind of ['choice', 'typed', 'trigger', 'transform']) {
      expect(isDeferredItem({ kind } as CourseItem)).toBe(false);
    }
  });

  it('serves writing (T92d) and the speaking turns (T93), and defers the monologue', () => {
    expect(isDeferredItem({ kind: 'writing' } as CourseItem)).toBe(false);
    for (const kind of ['speaking-reply', 'speaking-situation']) {
      expect(isDeferredItem({ kind } as CourseItem)).toBe(false);
    }
    expect(isDeferredItem({ kind: 'speaking-monologue' } as unknown as CourseItem)).toBe(true);
    const { served, deferred } = servableItems([
      item('a', 'choice'),
      item('w', 'writing'),
      item('t', 'trigger'),
      item('s', 'speaking-reply'),
      item('m', 'speaking-monologue'),
    ]);
    expect(served.map((i) => i.id)).toEqual(['a', 'w', 't', 's']);
    expect(deferred).toEqual(['m']);
  });
});

describe('exam conditions by mode (decisions 4–6)', () => {
  it('shows feedback and translation in unit mode only', () => {
    expect(showsFeedback('unit')).toBe(true);
    expect(showsFeedback('floor')).toBe(false);
    expect(showsFeedback('extern')).toBe(false);
    expect(allowsTranslation('unit')).toBe(true);
    expect(allowsTranslation('floor')).toBe(false);
  });

  it('offers «Объясни ещё» mid-unit and in reviews, never mid-exam', () => {
    expect(allowsExplainMore('unit', 'run')).toBe(true);
    expect(allowsExplainMore('floor', 'run')).toBe(false);
    expect(allowsExplainMore('extern', 'run')).toBe(false);
    expect(allowsExplainMore('floor', 'review')).toBe(true);
  });
});

describe('verdicts', () => {
  it('maps points to full, half and wrong', () => {
    expect(verdictOf(1)).toBe('full');
    expect(verdictOf(0.5)).toBe('half');
    expect(verdictOf(0)).toBe('wrong');
  });
});

describe('retry draws (decision 2, D13)', () => {
  it('detects an identical draw regardless of order', () => {
    expect(isIdenticalDraw(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isIdenticalDraw(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(isIdenticalDraw(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('unit outcome', () => {
  const drawn = ['a', 'b', 'c', 'd', 'e'];
  it('passes at 80 % and lists the missed items in draw order', () => {
    const out = unitOutcome({
      percent: 80,
      drawn,
      points: { a: 1, b: 1, c: 1, d: 1, e: 0 },
      alreadyPassed: false,
    });
    expect(out.passed).toBe(true);
    expect(out.missed).toEqual(['e']);
    expect(out.firstPass).toBe(true);
  });

  it('a half-credit item counts as missed', () => {
    const out = unitOutcome({
      percent: 70,
      drawn: ['a', 'b'],
      points: { a: 1, b: 0.5 },
      alreadyPassed: false,
    });
    expect(out.passed).toBe(false);
    expect(out.missed).toEqual(['b']);
    expect(out.firstPass).toBe(false);
  });

  it('gives first-pass XP only once', () => {
    const out = unitOutcome({ percent: 100, drawn, points: {}, alreadyPassed: true });
    expect(out.passed).toBe(true);
    expect(out.firstPass).toBe(false);
  });
});

describe('exam outcome (decision 5, D13)', () => {
  const units = [
    { id: 'u1', items: ['a', 'b'] },
    { id: 'u2', items: ['c', 'd'] },
  ];

  it('a floor pass at 80 % has no cooldown and no weakest unit', () => {
    const out = examOutcome({
      kind: 'floor',
      percent: 80,
      drawn: ['a', 'b', 'c', 'd', 'e'],
      points: { a: 1, b: 1, c: 1, d: 1, e: 0 },
      units,
    });
    expect(out.passed).toBe(true);
    expect(out.cooldownMinutes).toBe(0);
    expect(out.weakestUnitId).toBeNull();
  });

  it('a floor fail starts 20 min and points at the weakest unit', () => {
    const out = examOutcome({
      kind: 'floor',
      percent: 60,
      drawn: ['a', 'b', 'c', 'd'],
      points: { c: 1, d: 1 },
      units,
    });
    expect(out.passed).toBe(false);
    expect(out.cooldownMinutes).toBe(20);
    expect(out.weakestUnitId).toBe('u1');
  });

  it('an экстерн needs 90 % and a fail starts 60 min, with no weakest unit', () => {
    const at80 = examOutcome({ kind: 'extern', percent: 80, drawn: ['a'], points: {}, units });
    expect(at80.passed).toBe(false);
    expect(at80.cooldownMinutes).toBe(60);
    expect(at80.weakestUnitId).toBeNull();
    expect(
      examOutcome({ kind: 'extern', percent: 90, drawn: ['a'], points: { a: 1 }, units }).passed,
    ).toBe(true);
  });
});
