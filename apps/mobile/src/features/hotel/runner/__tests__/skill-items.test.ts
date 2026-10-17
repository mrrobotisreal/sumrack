import { describe, expect, it } from 'vitest';

import {
  isSkillItem,
  keepPass,
  maxPlaysFor,
  speakingCorrect,
  WRITING_CORRECT_PCT,
  writingCorrect,
  writingResponse,
} from '../skill-items';
import { scoreAttempt } from '../../hotel-model';

describe('skill items (T92c D8)', () => {
  it('routes writing and both speaking kinds to the skill component, not the choice/typed views', () => {
    expect(isSkillItem({ kind: 'writing' } as never)).toBe(true);
    expect(isSkillItem({ kind: 'speaking-reply' } as never)).toBe(true);
    expect(isSkillItem({ kind: 'speaking-situation' } as never)).toBe(true);
    expect(isSkillItem({ kind: 'choice' } as never)).toBe(false);
    expect(isSkillItem({ kind: 'typed' } as never)).toBe(false);
  });

  it('counts a writing item correct at 66 % and not below', () => {
    expect(WRITING_CORRECT_PCT).toBe(66);
    expect(writingCorrect(66)).toBe(true);
    expect(writingCorrect(65.9)).toBe(false);
    expect(writingCorrect(100)).toBe(true);
  });

  it('counts a speaking item correct only on a judge pass', () => {
    expect(speakingCorrect('pass')).toBe(true);
    expect(speakingCorrect('fail')).toBe(false);
    expect(speakingCorrect('borderline')).toBe(false);
    expect(speakingCorrect(null)).toBe(false);
  });

  it('limits audio to 2 plays in a floor exam or экстерн, unlimited in practice', () => {
    expect(maxPlaysFor('unit')).toBeUndefined();
    expect(maxPlaysFor('floor')).toBe(2);
    expect(maxPlaysFor('extern')).toBe(2);
  });

  it('never revokes a pass: the AI final can only add a pass', () => {
    expect(keepPass(true, false, 10)).toBe(true);
    expect(keepPass(false, true, 10)).toBe(true);
    expect(keepPass(false, false, 70)).toBe(true);
    expect(keepPass(false, false, 40)).toBe(false);
  });
});

describe('writing response (T92d): the stored verdict scores the run', () => {
  it('stores the letter with the offline verdict (≥ 66 % correct)', () => {
    expect(writingResponse('Привет', 66)).toEqual({
      answer: { kind: 'writing', text: 'Привет' },
      correct: true,
    });
    expect(writingResponse('Привет', 40).correct).toBe(false);
  });

  it('counts a graded writing item in the run percent; an ungraded one stays pending', () => {
    const w = { id: 'w1', kind: 'writing', topic: 'write-note' } as never;
    const graded = scoreAttempt([w], { w1: { answer: 'x', correct: true } } as never);
    expect(graded).toMatchObject({ total: 1, correct: 1, percent: 100, pending: [] });
    const failed = scoreAttempt([w], { w1: { answer: 'x', correct: false } } as never);
    expect(failed).toMatchObject({ total: 1, correct: 0, percent: 0 });
    const ungraded = scoreAttempt([w], {} as never);
    expect(ungraded).toMatchObject({ total: 0, pending: ['w1'] });
  });
});
