import { ExamSchema, type Exam } from '@sumrak/schema';
import a1ExamPack from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import a2ExamPack from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  countersLine,
  wordAtSelection,
  writingChecklist,
  writingCounters,
  writingTaskOf,
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

describe('writingTaskOf (T75, A2-12 analytics task + topic)', () => {
  const exams = (pack: { exams: unknown[] }): Exam[] => pack.exams.map((e) => ExamSchema.parse(e));
  const A1_MOCK = exams(a1ExamPack as unknown as { exams: unknown[] }).find(
    (e) => e.id === 'a1-mock-fx',
  )!;
  const A2_MOCK = exams(a2ExamPack as unknown as { exams: unknown[] }).find(
    (e) => e.id === 'a2-mock-fx',
  )!;

  const writingSubtest = (exam: Exam) => exam.subtests.find((s) => s.kind === 'writing')!;

  it('A1: the single letter is task 1 / write-letter', () => {
    const st = writingSubtest(A1_MOCK);
    expect(writingTaskOf(A1_MOCK, st.id, 'wr01')).toEqual({ task: 1, topic: 'write-letter' });
  });

  it('A2: the first writing item is task 1 / write-letter, the note is task 2 / write-note', () => {
    const st = writingSubtest(A2_MOCK);
    expect(writingTaskOf(A2_MOCK, st.id, 'wr01')).toEqual({ task: 1, topic: 'write-letter' });
    expect(writingTaskOf(A2_MOCK, st.id, 'wr02')).toEqual({ task: 2, topic: 'write-note' });
  });

  it('an unknown item or subtest is { task: 0, topic: "none" }', () => {
    const st = writingSubtest(A2_MOCK);
    expect(writingTaskOf(A2_MOCK, st.id, 'no-such-item')).toEqual({ task: 0, topic: 'none' });
    expect(writingTaskOf(A2_MOCK, 'no-such-subtest', 'wr01')).toEqual({
      task: 0,
      topic: 'none',
    });
  });

  it('a non-writing item id is not a writing task', () => {
    const objective = A1_MOCK.subtests.find((s) => s.kind !== 'writing')!;
    const id = objective.parts[0]!.items[0]!.id;
    expect(writingTaskOf(A1_MOCK, objective.id, id)).toEqual({ task: 0, topic: 'none' });
  });
});
