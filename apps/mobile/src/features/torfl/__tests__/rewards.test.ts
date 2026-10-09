import { describe, expect, it } from 'vitest';

import { examAchievements, examXp, type ExamRewardInput } from '../rewards';

const five = (n: number) => ({ writing: n, lexgram: n, reading: n, listening: n, speaking: n });
const base: ExamRewardInput = {
  scope: 'full',
  scoredSubtests: 3,
  pcts: { lexgram: 50, reading: 50, listening: 50 },
  verdict: null,
  firstPass: true,
};

describe('examXp', () => {
  it('15 per scored subtest + 60 for a full mock', () => {
    expect(examXp(base)).toBe(3 * 15 + 60);
    expect(examXp({ ...base, scope: 'subtest', scoredSubtests: 1 })).toBe(15);
  });
  it('skipped placeholders earn nothing; a full mock with nothing scored earns nothing', () => {
    expect(examXp({ ...base, scoredSubtests: 0 })).toBe(0);
  });
  it('+100 only for the FIRST pass / pass-borderline verdict', () => {
    const pass = { ...base, scoredSubtests: 5, pcts: five(70), verdict: 'pass' as const };
    expect(examXp(pass)).toBe(5 * 15 + 60 + 100);
    expect(examXp({ ...pass, firstPass: false })).toBe(5 * 15 + 60);
    expect(examXp({ ...pass, verdict: 'pass-borderline' })).toBe(5 * 15 + 60 + 100);
    expect(examXp({ ...pass, verdict: 'fail' })).toBe(5 * 15 + 60);
  });
});

describe('examAchievements', () => {
  it('a three-subtest mock: first-mock only (lexgram-90 needs 90)', () => {
    expect(examAchievements(base)).toEqual(['torfl-first-mock']);
    expect(examAchievements({ ...base, pcts: { lexgram: 90 } })).toEqual([
      'torfl-first-mock',
      'torfl-lexgram-90',
    ]);
    expect(examAchievements({ ...base, pcts: { lexgram: 89.9 } })).toEqual(['torfl-first-mock']);
  });
  it('would-pass needs a five-subtest verdict of pass / borderline', () => {
    const v = { ...base, scoredSubtests: 5, pcts: five(70) };
    expect(examAchievements({ ...v, verdict: 'pass' })).toContain('torfl-would-pass');
    expect(examAchievements({ ...v, verdict: 'pass-borderline' })).toContain('torfl-would-pass');
    expect(examAchievements({ ...v, verdict: 'fail' })).not.toContain('torfl-would-pass');
    expect(examAchievements(base)).not.toContain('torfl-would-pass');
  });
  it('margin needs all five ≥ 80 inside a verdict', () => {
    const v = { ...base, scoredSubtests: 5, verdict: 'pass' as const };
    expect(examAchievements({ ...v, pcts: five(80) })).toContain('torfl-margin');
    expect(examAchievements({ ...v, pcts: { ...five(85), speaking: 79.9 } })).not.toContain(
      'torfl-margin',
    );
    expect(examAchievements({ ...v, verdict: null, pcts: five(90) })).not.toContain('torfl-margin');
  });
  it('nothing scored → nothing unlocked', () => {
    expect(examAchievements({ ...base, scoredSubtests: 0, pcts: {} })).toEqual([]);
  });
});

describe('per level (T75, A2-11)', () => {
  const passFive = {
    ...base,
    scope: 'full' as const,
    scoredSubtests: 5,
    pcts: five(90),
    verdict: 'pass' as const,
  };
  const fourA1 = ['torfl-first-mock', 'torfl-lexgram-90', 'torfl-would-pass', 'torfl-margin'];
  const fourA2 = [
    'torfl-a2-first-mock',
    'torfl-a2-lexgram-90',
    'torfl-a2-would-pass',
    'torfl-a2-margin',
  ];

  it('A2 five(90)+pass → the four A2 ids, in order', () => {
    expect(examAchievements({ ...passFive, level: 'A2' })).toEqual(fourA2);
  });

  it('the same input at A1 → the four A1 ids; level absent → A1 too', () => {
    expect(examAchievements({ ...passFive, level: 'A1' })).toEqual(fourA1);
    expect(examAchievements(passFive)).toEqual(fourA1);
  });

  it('an A2 input never yields an A1 id, and an A1 input never yields an A2 id', () => {
    const cases: ExamRewardInput[] = [
      { ...base, scope: 'full', scoredSubtests: 5, pcts: five(40), verdict: 'fail' },
      { ...base, scope: 'full', scoredSubtests: 5, pcts: five(70), verdict: 'pass' },
      { ...base, scoredSubtests: 1, pcts: { lexgram: 95 }, verdict: null },
    ];
    for (const c of cases) {
      for (const level of ['A1', 'A2'] as const) {
        const ids = examAchievements({ ...c, level });
        for (const id of ids) {
          if (level === 'A2') expect(id.startsWith('torfl-a2-')).toBe(true);
          else expect(id.startsWith('torfl-a2-')).toBe(false);
        }
      }
    }
  });
});
