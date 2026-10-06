import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildExamSpeakingMessages, type ExamSpeakingInput } from '../prompts/exam-speaking';
import {
  EXAM_SPEAKING_MONOLOGUE_CRITERION_IDS,
  EXAM_SPEAKING_TURN_CRITERION_IDS,
  parseExamGrade,
} from '../schemas';

/**
 * T73: the exam-speaking prompt contract + the four captured fixtures (a
 * task-1 reply and a task-3 monologue, graded by the Claude-class and the
 * GPT-class «normal» model at effort high — `scripts/capture-ai-fixtures.ts
 * exam-speaking`). Parsed with the production parser; no live call here.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

interface Fixture {
  input: ExamSpeakingInput;
  model: string;
  ms: number;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage: { cost?: number; completion_tokens?: number } | null;
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
}

const NAMES = [
  'exam-speaking-reply-claude',
  'exam-speaking-monologue-claude',
  'exam-speaking-reply-gpt',
  'exam-speaking-monologue-gpt',
] as const;

describe('exam-speaking prompt', () => {
  it('task 1: the question, the ASR caveat, both transcripts, the three turn ids', () => {
    const messages = buildExamSpeakingMessages({
      task: 'reply',
      promptRu: 'Где вы сейчас живёте?',
      transcript: 'я живу в колорадо',
      assistTranscript: 'Я живу в Колорадо.',
      modelAnswer: 'Я сейчас в Москве.',
    });
    expect(messages[0]!.role).toBe('system');
    const sys = messages[0]!.content;
    for (const id of EXAM_SPEAKING_TURN_CRITERION_IDS) expect(sys).toContain(`"${id}"`);
    expect(sys).not.toContain('"coverage"');
    expect(sys).toContain('AUTOMATIC SPEECH RECOGNITION');
    expect(sys).toContain('task-1 REPLY');
    const user = messages[1]!.content;
    expect(user).toContain("THE EXAMINER'S QUESTION");
    expect(user).toContain('Где вы сейчас живёте?');
    expect(user).toContain('A MODEL ANSWER');
    expect(user).toContain('я живу в колорадо');
    expect(user).toContain('re-decoded by Whisper');
    expect(user).toContain('Я живу в Колорадо.');
  });

  it('task 2: the situation text; no assist → no Whisper block; empty transcript is named', () => {
    const user = buildExamSpeakingMessages({
      task: 'situation',
      promptRu: 'Вы хотите узнать, где работает ваш друг.',
      situationRu: 'Вы хотите узнать, где работает ваш друг. Спросите его.',
      transcript: '',
    })[1]!.content;
    expect(user).toContain('THE SITUATION');
    expect(user).toContain('Спросите его.');
    expect(user).not.toContain('Whisper');
    expect(user).toContain('(nothing recognized)');
  });

  it('task 3: the topic, numbered questions, the sentence range, the four monologue ids', () => {
    const messages = buildExamSpeakingMessages({
      task: 'monologue',
      promptRu: 'О себе',
      questionsRu: ['Как вас зовут?', 'Откуда вы?'],
      minSentences: 10,
      maxSentences: 12,
      transcript: 'меня зовут митч',
    });
    const sys = messages[0]!.content;
    for (const id of EXAM_SPEAKING_MONOLOGUE_CRITERION_IDS) expect(sys).toContain(`"${id}"`);
    expect(sys).not.toContain('"task-response"');
    const user = messages[1]!.content;
    expect(user).toContain('THE TOPIC:\nО себе');
    expect(user).toContain('  1. Как вас зовут?');
    expect(user).toContain('  2. Откуда вы?');
    expect(user).toContain('Required: 10–12 sentences.');
    expect(user).not.toContain('MODEL ANSWER');
  });
});

describe('captured exam-speaking fixtures (Claude-class + GPT-class, reply + monologue)', () => {
  for (const name of NAMES) {
    it(`${name}: parses through ExamGradeSchema with the task's pinned ids`, () => {
      const fx = fixture(name);
      expect(fx.choices[0]!.finish_reason).toBe('stop');
      const grade = parseExamGrade(fx.choices[0]!.message.content);
      expect(grade).not.toBeNull();
      const ids =
        fx.input.task === 'monologue'
          ? EXAM_SPEAKING_MONOLOGUE_CRITERION_IDS
          : EXAM_SPEAKING_TURN_CRITERION_IDS;
      expect(grade!.criteria.map((c) => c.id)).toEqual([...ids]);
      expect(grade!.criteria.reduce((n, c) => n + c.max, 0)).toBe(100);
      expect(grade!.corrected).toBeTruthy();
      expect(grade!.tips.length).toBeGreaterThanOrEqual(1);
      expect(fx.usage?.cost).toBeGreaterThan(0);
    });
  }

  it('both graders catch the planted agreement errors («с моя невеста», «слушать музыка»)', () => {
    for (const name of NAMES) {
      const fx = fixture(name);
      const grade = parseExamGrade(fx.choices[0]!.message.content)!;
      const corrected = grade.corrected ?? '';
      expect(corrected).not.toContain('с моя невеста');
      expect(corrected.toLowerCase()).toContain('невест');
      if (fx.input.task === 'monologue') {
        expect(corrected).not.toContain('слушать музыка');
      }
    }
  });
});
