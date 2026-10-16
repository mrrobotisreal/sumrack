import type { CourseCard } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  cardForTopic,
  cardProgress,
  clampCard,
  foldRu,
  highlightIndices,
  lessonKey,
  lessonSentenceRefs,
  parseLessonPositions,
  resumeIndex,
  topicLabel,
} from '../lesson-model';

const tok = (text: string, isPunct = false) => ({ text, isPunct });

describe('highlightIndices', () => {
  const sentence = [tok('Я'), tok('живу'), tok('в'), tok('большом'), tok('городе'), tok('.', true)];

  it('colours the token matching each highlight surface', () => {
    expect([...highlightIndices(sentence, ['городе'])]).toEqual([4]);
  });

  it('matches ё and е interchangeably', () => {
    const tokens = [tok('Она'), tok('живёт'), tok('в'), tok('Берлине')];
    expect([...highlightIndices(tokens, ['живет'])]).toEqual([1]);
    expect([...highlightIndices([tok('ёлка')], ['елка'])]).toEqual([0]);
  });

  it('is case-insensitive', () => {
    expect([...highlightIndices([tok('Москве')], ['москве'])]).toEqual([0]);
  });

  it('takes the first unused occurrence per entry (a repeated word colours twice)', () => {
    const tokens = [tok('в'), tok('школе'), tok('и'), tok('в'), tok('школе')];
    expect([...highlightIndices(tokens, ['в', 'школе', 'школе'])].sort()).toEqual([0, 1, 4].sort());
  });

  it('never matches punctuation and skips surfaces that are absent', () => {
    expect(highlightIndices(sentence, ['.', 'нет']).size).toBe(0);
  });
});

describe('foldRu', () => {
  it('lowers case and folds ё', () => {
    expect(foldRu('Ёлка')).toBe('елка');
  });
});

describe('cardForTopic', () => {
  const explain = (id: string, title: string, why?: string): CourseCard => ({
    id,
    kind: 'explain',
    title: { ru: title, en: title },
    body: 'b',
    examples: why
      ? [{ sentenceRef: { storyId: 's', sentenceId: 'x' }, highlight: ['x'], why }]
      : [],
  });
  const cards: CourseCard[] = [
    { id: 'c0', kind: 'check', items: ['i1'] },
    explain('c1', 'Мужской род'),
    explain('c2', 'Предложный падеж', 'в + где? → предложный'),
    {
      id: 'c3',
      kind: 'traps',
      title: { ru: 't', en: 't' },
      pairs: [{ wrong: 'a', right: { storyId: 's', sentenceId: 'x' }, reason: 'r' }],
    },
    explain('c4', 'Ещё'),
  ];

  it('jumps to the explain card whose why-line names the topic', () => {
    expect(cardForTopic(cards, 'в + где?')?.cardIndex).toBe(2);
  });

  it('falls back to the first explain card when no card names the topic', () => {
    expect(cardForTopic(cards, 'Винительный')?.cardIndex).toBe(1);
  });

  it('returns null when a unit has no explain card', () => {
    expect(cardForTopic([cards[0]!, cards[3]!], 'x')).toBeNull();
  });

  it('labels a topic slug as words', () => {
    expect(topicLabel({ topic: 'case-prep' })).toBe('case prep');
  });
});

describe('lesson position', () => {
  it('parses only non-negative integers and drops junk', () => {
    expect(parseLessonPositions({ 'a:u1': 3, 'a:u2': -1, 'a:u3': 1.5, 'a:u4': 'x' })).toEqual({
      'a:u1': 3,
    });
    expect(parseLessonPositions(null)).toEqual({});
    expect(parseLessonPositions([1, 2])).toEqual({});
  });

  it('resumes at the saved card, clamped into a shorter unit', () => {
    const unit = { id: 'u1', cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as never;
    expect(resumeIndex({ [lessonKey('p', 'u1')]: 2 }, 'p', unit)).toBe(2);
    expect(resumeIndex({ [lessonKey('p', 'u1')]: 9 }, 'p', unit)).toBe(2);
    expect(resumeIndex({}, 'p', unit)).toBe(0);
  });

  it('clamps the pager and computes progress', () => {
    expect(clampCard(-1, 4)).toBe(0);
    expect(clampCard(9, 4)).toBe(3);
    expect(clampCard(2, 0)).toBe(0);
    expect(cardProgress(0, 4)).toBe(0.25);
    expect(cardProgress(3, 4)).toBe(1);
    expect(cardProgress(0, 0)).toBe(0);
  });
});

describe('lessonSentenceRefs', () => {
  it('lists the sentences a lesson voices: examples and trap rights, in order', () => {
    const cards: CourseCard[] = [
      {
        id: 'x1',
        kind: 'explain',
        title: { ru: 'a', en: 'a' },
        body: 'b',
        examples: [{ sentenceRef: { storyId: 's', sentenceId: 'e1' }, highlight: [] }],
      },
      { id: 'k', kind: 'check', items: ['i'] },
      {
        id: 't',
        kind: 'traps',
        title: { ru: 't', en: 't' },
        pairs: [{ wrong: 'w', right: { storyId: 's', sentenceId: 'r1' }, reason: 'r' }],
      },
    ];
    expect(lessonSentenceRefs({ cards })).toEqual([
      { storyId: 's', sentenceId: 'e1' },
      { storyId: 's', sentenceId: 'r1' },
    ]);
  });
});
