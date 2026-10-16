import type { CourseItem } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import { checkAnswered, checkChosen, checkCorrect } from '../check-model';

const choice = (id: string, answer: number) =>
  ({
    id,
    topic: 't',
    kind: 'choice',
    stem: 'Я живу … городе.',
    stemEn: 'x',
    options: ['в', 'на', 'за'],
    answer,
    explain: 'e',
  }) as unknown as CourseItem;

const trigger = (id: string) =>
  ({
    id,
    topic: 't',
    kind: 'trigger',
    sentence: 'Я читаю о Москве.',
    tokens: ['Я', 'читаю', 'о', 'Москве'],
    answer: 2,
    explain: 'e',
  }) as unknown as CourseItem;

const typed = (id: string) =>
  ({
    id,
    topic: 't',
    kind: 'typed',
    prompt: 'Это брат. → о …',
    accept: ['брате'],
    explain: 'e',
  }) as unknown as CourseItem;

describe('checkCorrect', () => {
  it('scores choice and trigger on the index', () => {
    expect(checkCorrect(choice('a', 0), 0)).toBe(true);
    expect(checkCorrect(choice('a', 0), 2)).toBe(false);
    expect(checkCorrect(trigger('t'), 2)).toBe(true);
    expect(checkCorrect(trigger('t'), 3)).toBe(false);
  });

  it('scores a typed answer through the T89 scorer (ё/е fold)', () => {
    expect(checkCorrect(typed('x'), 'брате')).toBe(true);
    expect(checkCorrect(typed('x'), 'брат')).toBe(false);
  });
});

describe('checkAnswered (the «Далее» gate)', () => {
  it('opens only once every check item has a response', () => {
    const items = [choice('a', 0), trigger('t')];
    expect(checkAnswered(items, {})).toBe(false);
    expect(checkAnswered(items, { a: { answer: 0, correct: true } })).toBe(false);
    expect(
      checkAnswered(items, {
        a: { answer: 0, correct: true },
        t: { answer: 1, correct: false },
      }),
    ).toBe(true);
  });

  it('is never open for an empty check', () => {
    expect(checkAnswered([], {})).toBe(false);
  });
});

describe('checkChosen', () => {
  it('names the wrong choice and nothing when right', () => {
    expect(checkChosen(choice('a', 0), { answer: 1, correct: false })).toBe('на');
    expect(checkChosen(choice('a', 0), { answer: 0, correct: true })).toBeUndefined();
  });

  it('names the tapped token of a wrong trigger', () => {
    expect(checkChosen(trigger('t'), { answer: 0, correct: false })).toBe('Я');
  });

  it('names a typed wrong answer', () => {
    expect(checkChosen(typed('x'), { answer: 'брат', correct: false })).toBe('брат');
  });
});
