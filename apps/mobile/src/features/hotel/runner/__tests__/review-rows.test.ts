import type { CourseItem } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import { reviewRows } from '../review-model';

const choice = {
  id: 'a',
  topic: 't',
  kind: 'choice',
  stem: 'x … y',
  stemEn: 'x',
  options: ['в', 'на', 'за'],
  answer: 1,
  explain: 'Trigger: на. Rule: x. Why each wrong option is wrong: y.',
} as unknown as CourseItem;

const trigger = {
  id: 't',
  topic: 't',
  kind: 'trigger',
  sentence: 'Я читаю о Москве.',
  tokens: ['Я', 'читаю', 'о', 'Москве'],
  answer: 2,
  explain: 'e',
} as unknown as CourseItem;

describe('reviewRows', () => {
  it('shows the learner answer, the key and the verdict for each item', () => {
    const rows = reviewRows(
      [choice, trigger],
      { a: { answer: 0, correct: false }, t: { answer: 2, correct: true } },
      (id) => (id === 't' ? 1 : 0),
    );
    expect(rows[0]).toMatchObject({ verdict: 'wrong', yourAnswer: 'в', key: 'на' });
    expect(rows[1]).toMatchObject({ verdict: 'full', yourAnswer: 'о', key: 'о' });
  });

  it('shows a dash for a blank answer and a half credit as «Почти»', () => {
    const [row] = reviewRows([choice], {}, () => 0.5);
    expect(row).toMatchObject({ yourAnswer: '—', verdict: 'half' });
  });
});
