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
