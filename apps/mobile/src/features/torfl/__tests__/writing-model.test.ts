import { describe, expect, it } from 'vitest';

import {
  countersLine,
  wordAtSelection,
  writingChecklist,
  writingCounters,
} from '../writing/writing-model';

const ITEM = {
  minSentences: 10,
  minQuestions: 2,
  maxQuestions: 5,
  bullets: [
    { id: 'b1', text: { ru: 'как вас зовут', en: 'name' }, cues: ['зовут'] },
    { id: 'b2', text: { ru: 'где вы живёте', en: 'live' }, cues: ['живу', 'живём'] },
  ],
};

describe('writing editor model', () => {
  it('counters + flags', () => {
    const c = writingCounters(ITEM, 'Меня зовут Митч. Как дела? Где ты?');
    expect(c).toMatchObject({ sentences: 3, questions: 2, lengthOk: false, questionsOk: true });
    expect(countersLine(c)).toBe('Предложений: 3 / ≥ 10 · Вопросов: 2 / 2–5');
    expect(countersLine(writingCounters({ ...ITEM, maxQuestions: undefined }, 'А?'))).toBe(
      'Предложений: 1 / ≥ 10 · Вопросов: 1 / ≥ 2',
    );
  });
  it('checklist ticks as cues match', () => {
    expect(writingChecklist(ITEM, 'Меня зовут Митч.').map((r) => [r.id, r.done])).toEqual([
      ['b1', true],
      ['b2', false],
    ]);
  });
  it('wordAtSelection: a selection wins; a caret expands to the word around it', () => {
    const t = 'Я живу в Колорадо.';
    expect(wordAtSelection(t, 2, 6)).toBe('живу');
    expect(wordAtSelection(t, 11, 11)).toBe('Колорадо');
    expect(wordAtSelection(t, 1, 1)).toBe('Я');
    expect(wordAtSelection(t, 18, 18)).toBe('');
  });
});
