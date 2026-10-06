import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildExamWritingMessages, type ExamWritingInput } from '../prompts/exam-writing';
import { ExamGradeSchema, parseExamGrade } from '../schemas';

/**
 * T72: the exam-writing prompt contract + the four captured fixtures (one
 * good and one weak letter, graded by the Claude-class and the GPT-class
 * «normal» model at effort high — `scripts/capture-ai-fixtures.ts
 * exam-writing`). Parsed with the production parser; no live call here.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

interface Fixture {
  input: ExamWritingInput;
  model: string;
  ms: number;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage: { cost?: number; completion_tokens?: number } | null;
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
}

const NAMES = [
  'exam-writing-good-claude',
  'exam-writing-weak-claude',
  'exam-writing-good-gpt',
  'exam-writing-weak-gpt',
] as const;

describe('exam-writing prompt', () => {
  it('system pins the five criteria + JSON keys; user carries the task, bullets, counts, letter', () => {
    const messages = buildExamWritingMessages({
      taskRu: 'Напишите письмо другу.',
      bullets: [
        { id: 'b1', ru: 'как вас зовут' },
        { id: 'b2', ru: 'где вы живёте' },
      ],
      minSentences: 10,
      minQuestions: 2,
      maxQuestions: 5,
      letter: 'Привет! Меня зовут Митч.',
      modelLetter: 'Здравствуй, Саша! Меня зовут Анна.',
    });
    expect(messages[0]!.role).toBe('system');
    for (const key of [
      '"task-points"',
      '"task-length"',
      '"letter-form"',
      '"vocabulary"',
      '"grammar"',
      '"corrected"',
      '"changes"',
      '"tips"',
    ]) {
      expect(messages[0]!.content).toContain(key);
    }
    const user = messages[1]!.content;
    expect(user).toContain('Напишите письмо другу.');
    expect(user).toContain('1. как вас зовут');
    expect(user).toContain('2. где вы живёте');
    expect(user).toContain('at least 10 sentences');
    expect(user).toContain('2–5 questions');
    expect(user).toContain('A MODEL LETTER');
    expect(user).toContain('Меня зовут Анна.');
    expect(user.endsWith('Привет! Меня зовут Митч.')).toBe(true);
  });

  it('no model letter → no calibration block; no maxQuestions → «at least N question(s)»', () => {
    const user = buildExamWritingMessages({
      taskRu: 'Т',
      bullets: [{ id: 'b1', ru: 'п' }],
      minSentences: 5,
      minQuestions: 1,
      letter: 'Я.',
    })[1]!.content;
    expect(user).not.toContain('MODEL LETTER');
    expect(user).toContain('at least 1 question(s)');
  });
});

describe('ExamGradeSchema', () => {
  const ok = {
    criteria: [
      { id: 'task-points', score: 26, max: 30 },
      { id: 'task-length', score: 15, max: 15 },
      { id: 'letter-form', score: 10, max: 10 },
      { id: 'vocabulary', score: 18.5, max: 20 },
      { id: 'grammar', score: 25, max: 25 },
    ],
    tips: ['Keep it up.'],
  };
  it('accepts a full set; defaults changes/tips', () => {
    const g = ExamGradeSchema.parse({ criteria: ok.criteria });
    expect(g.changes).toEqual([]);
    expect(g.tips).toEqual([]);
  });
  it('refuses score > max, Σ max ≠ 100, duplicate ids', () => {
    expect(
      ExamGradeSchema.safeParse({
        ...ok,
        criteria: ok.criteria.map((c, i) => (i === 0 ? { ...c, score: 31 } : c)),
      }).success,
    ).toBe(false);
    expect(ExamGradeSchema.safeParse({ ...ok, criteria: ok.criteria.slice(1) }).success).toBe(
      false,
    );
    expect(
      ExamGradeSchema.safeParse({
        ...ok,
        criteria: [...ok.criteria.slice(0, 4), { ...ok.criteria[4]!, id: 'vocabulary', max: 25 }],
      }).success,
    ).toBe(false);
  });
  it('parseExamGrade tolerates fences and lead-in prose, returns null on garbage', () => {
    expect(parseExamGrade('```json\n' + JSON.stringify(ok) + '\n```')).not.toBeNull();
    expect(parseExamGrade('Here you go: ' + JSON.stringify(ok))).not.toBeNull();
    expect(parseExamGrade('no json here')).toBeNull();
    expect(parseExamGrade('{"criteria": []}')).toBeNull();
  });
});

describe('captured exam-writing fixtures (Claude-class + GPT-class, good + weak letter)', () => {
  for (const name of NAMES) {
    it(`${name}: parses through ExamGradeSchema with the five pinned ids`, () => {
      const fx = fixture(name);
      expect(fx.choices[0]!.finish_reason).toBe('stop');
      const grade = parseExamGrade(fx.choices[0]!.message.content);
      expect(grade).not.toBeNull();
      expect(grade!.criteria.map((c) => c.id)).toEqual([
        'task-points',
        'task-length',
        'letter-form',
        'vocabulary',
        'grammar',
      ]);
      expect(grade!.corrected).toBeTruthy();
      expect(grade!.tips.length).toBeGreaterThanOrEqual(1);
      // Every change's `before` is really in the letter (the diff view depends on it).
      for (const ch of grade!.changes) {
        if (ch.before.length > 0) expect(fx.input.letter).toContain(ch.before);
      }
      expect(fx.usage?.cost).toBeGreaterThan(0);
    });
  }

  it('the good letter outscores the weak one on both graders', () => {
    const total = (name: (typeof NAMES)[number]) =>
      parseExamGrade(fixture(name).choices[0]!.message.content)!.criteria.reduce(
        (n, c) => n + c.score,
        0,
      );
    expect(total('exam-writing-good-claude')).toBeGreaterThan(total('exam-writing-weak-claude'));
    expect(total('exam-writing-good-gpt')).toBeGreaterThan(total('exam-writing-weak-gpt'));
    // The weak letter has real errors → both graders propose corrections; the good one none.
    const changes = (name: (typeof NAMES)[number]) =>
      parseExamGrade(fixture(name).choices[0]!.message.content)!.changes.length;
    expect(changes('exam-writing-weak-claude')).toBeGreaterThan(0);
    expect(changes('exam-writing-weak-gpt')).toBeGreaterThan(0);
  });
});
