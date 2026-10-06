import { ExamSchema, type Exam, type Pack, type WritingItem } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  AI_ONLY_CRITERION_IDS,
  OFFLINE_CRITERION_IDS,
  OFFLINE_MAX,
  SELF_CHECKS,
  WRITING_CRITERIA,
  WRITING_MAX,
  bulletCoverage,
  countQuestions,
  criteriaPercent,
  gradeWritingOffline,
  letterForm,
  offlineItemScore,
  selfCheckCriteria,
  sentenceSplit,
} from '../grading/writing';

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const ITEM = EXAM.subtests
  .find((s) => s.kind === 'writing')!
  .parts.flatMap((p) => p.items)
  .find((i) => i.kind === 'writing') as WritingItem;

/** A good A1 letter: 11 sentences, 3 questions, all four bullets, greeting + sign-off. */
export const GOOD_LETTER = [
  'Привет, Саша!',
  'Меня зовут Митч. Мне тридцать шесть лет. Я живу в Колорадо.',
  'Я работаю программистом. Это интересная работа.',
  'Я люблю читать и слушать музыку. Ещё мне нравится готовить.',
  'А как ты? Где ты сейчас живёшь? Что ты любишь делать?',
  'Пока! Жду ответа.',
  'Твой друг Митч',
].join('\n');

/** Short, no questions, no greeting, two bullets missing. */
const WEAK_LETTER = 'Меня зовут Митч. Я живу в Колорадо. Я работаю. Пока.';

/** Long but no questions and no form. */
const NO_QUESTIONS = Array.from({ length: 10 }, (_, i) => `Я живу тут ${i}.`).join(' ');

/** Questionnaire: too many questions. */
const TOO_MANY_Q = `${GOOD_LETTER}\nКто ты? Что ты? Где ты? Когда? Почему?`;

describe('sentenceSplit / countQuestions', () => {
  it('splits on . ! ? … runs, counts ? once per sentence, ignores empty fragments', () => {
    const s = sentenceSplit('Привет!!! Как дела?! Хорошо… Да. . . Что?');
    expect(s.sentences).toEqual(['Привет', 'Как дела', 'Хорошо', 'Да', 'Что']);
    expect(s.questions).toBe(2);
    expect(countQuestions('Где? Кто? Нет.')).toBe(2);
  });

  it('a line without a terminator is still a sentence (greeting lines)', () => {
    const s = sentenceSplit('Дорогая Анна\nКак дела?\nПока');
    expect(s.sentences).toEqual(['Дорогая Анна', 'Как дела', 'Пока']);
    expect(s.questions).toBe(1);
  });

  it('empty text → nothing', () => {
    expect(sentenceSplit('   \n ')).toEqual({ sentences: [], questions: 0 });
  });
});

describe('bulletCoverage', () => {
  it('matches exact cues, stem globs and multi-word phrases over normalized tokens', () => {
    const c = bulletCoverage('Меня ЗОВУТ Митч, я работаю дома и очень люблю кофе.', [
      { id: 'name', cues: ['зовут'] },
      { id: 'work', cues: ['работа*'] },
      { id: 'like', cues: ['люблю', 'нравится'] },
      { id: 'home', cues: ['работаю дома'] },
      { id: 'live', cues: ['живу', 'живём'] },
    ]);
    expect(c.covered).toEqual(['name', 'work', 'like', 'home']);
    expect(c.missing).toEqual(['live']);
    expect(c.total).toBe(5);
  });

  it('ё/е tolerant and punctuation-blind', () => {
    const c = bulletCoverage('Мы живем в Киеве!', [{ id: 'live', cues: ['живём'] }]);
    expect(c.covered).toEqual(['live']);
  });
});

describe('letterForm', () => {
  it('greeting on the first line + a sign-off near the end', () => {
    expect(letterForm(GOOD_LETTER)).toEqual({ greeting: true, signOff: true });
    expect(letterForm('Здравствуйте, Анна Петровна! Я тут. С уважением, Митч')).toEqual({
      greeting: true,
      signOff: true,
    });
  });
  it('neither when the letter is a bare paragraph', () => {
    expect(letterForm(NO_QUESTIONS)).toEqual({ greeting: false, signOff: false });
  });
  it('a sign-off word buried in the middle of a long letter does not count', () => {
    const mid = `Привет!\nЯ сказал пока маме утром. ${'Потом я работал весь день. '.repeat(8)}Конец.`;
    expect(letterForm(mid)).toEqual({ greeting: true, signOff: false });
  });
});

describe('gradeWritingOffline (TORFL §6.2 table)', () => {
  it('the criteria table: 30 + 15 + 10 offline, 20 + 25 AI; Σ = 100, offline Σ = 55', () => {
    expect(WRITING_CRITERIA.reduce((n, c) => n + c.max, 0)).toBe(WRITING_MAX);
    expect(
      WRITING_CRITERIA.filter((c) => OFFLINE_CRITERION_IDS.includes(c.id)).reduce(
        (n, c) => n + c.max,
        0,
      ),
    ).toBe(OFFLINE_MAX);
    expect(AI_ONLY_CRITERION_IDS).toEqual(['vocabulary', 'grammar']);
  });

  it('a good letter: full marks on all three offline criteria → 55/55 → 100 % provisional', () => {
    const g = gradeWritingOffline(ITEM, GOOD_LETTER);
    expect(g.criteria).toEqual([
      { id: 'task-points', score: 30, max: 30 },
      { id: 'task-length', score: 15, max: 15 },
      { id: 'letter-form', score: 10, max: 10 },
    ]);
    expect(g.offlinePoints).toBe(55);
    expect(g.pct).toBe(100);
    expect(g.provisional).toBe(true);
    expect(g.details).toMatchObject({
      sentences: 14,
      questions: 3,
      pointsCovered: 4,
      pointsTotal: 4,
      greeting: true,
      signOff: true,
    });
  });

  it('rescaling 55 → 100 is documented: offlinePoints / 55 × 100, one decimal', () => {
    // 3 of 4 bullets (22.5) + 4/10 sentences (4) + 0/2 questions (0) + sign-off only (5) = 31.5
    const g = gradeWritingOffline(ITEM, WEAK_LETTER);
    expect(g.criteria.map((c) => c.score)).toEqual([22.5, 4, 5]);
    expect(g.offlinePoints).toBe(31.5);
    expect(g.pct).toBe(Math.round((31.5 / 55) * 1000) / 10); // 57.3
  });

  it('weak letter detail: which bullets are missing', () => {
    const g = gradeWritingOffline(ITEM, WEAK_LETTER);
    expect(g.details.coveredIds).toEqual(['b1', 'b2', 'b3']);
    expect(g.details.missingIds).toEqual(['b4']);
  });

  it('long but no questions and no form: length 10/10, questions 0/5, form 0', () => {
    const g = gradeWritingOffline(ITEM, NO_QUESTIONS);
    expect(g.criteria[1]).toEqual({ id: 'task-length', score: 10, max: 15 });
    expect(g.criteria[2]).toEqual({ id: 'letter-form', score: 0, max: 10 });
    expect(g.details.questions).toBe(0);
  });

  it('one question of the required two → half the questions share (2.5)', () => {
    const g = gradeWritingOffline(ITEM, `${NO_QUESTIONS} Как дела?`);
    expect(g.criteria[1]!.score).toBe(12.5);
  });

  it('a questionnaire above maxQuestions keeps only half the questions share', () => {
    const g = gradeWritingOffline(ITEM, TOO_MANY_Q);
    expect(g.details.questions).toBeGreaterThan(ITEM.maxQuestions!);
    expect(g.criteria[1]!.score).toBe(12.5);
  });

  it('no greeting but a sign-off: 5 of 10 form points', () => {
    const g = gradeWritingOffline(ITEM, `${NO_QUESTIONS} До свидания!`);
    expect(g.criteria[2]!.score).toBe(5);
  });

  it('an empty letter scores 0 on every criterion', () => {
    const g = gradeWritingOffline(ITEM, '  \n');
    expect(g.criteria.map((c) => c.score)).toEqual([0, 0, 0]);
    expect(g.pct).toBe(0);
  });

  it('offlineItemScore maps the provisional pct onto the subtest points', () => {
    const g = gradeWritingOffline(ITEM, WEAK_LETTER);
    expect(offlineItemScore(g, 100)).toEqual({ points: 57.3, maxPoints: 100, outcome: 'half' });
    expect(offlineItemScore(gradeWritingOffline(ITEM, GOOD_LETTER), 100).outcome).toBe('full');
  });
});

describe('criteriaPercent + the self-check fold', () => {
  it('a full AI set is Σ score / 100', () => {
    expect(
      criteriaPercent([
        { id: 'task-points', score: 27, max: 30 },
        { id: 'task-length', score: 12, max: 15 },
        { id: 'letter-form', score: 10, max: 10 },
        { id: 'vocabulary', score: 14, max: 20 },
        { id: 'grammar', score: 17.5, max: 25 },
      ]),
    ).toBe(80.5);
    expect(criteriaPercent([])).toBe(0);
  });

  it('the four self-checks split the 45 AI-only points (10 + 10 + 12 + 13)', () => {
    expect(SELF_CHECKS.reduce((n, c) => n + c.max, 0)).toBe(45);
    const offline = gradeWritingOffline(ITEM, GOOD_LETTER).criteria;
    const all = selfCheckCriteria(offline, {
      'vocab-range': 1,
      'vocab-fit': 0.5,
      'grammar-cases': 0,
      'grammar-verbs': 1,
    });
    expect(all.map((c) => [c.id, c.score, c.max])).toEqual([
      ['task-points', 30, 30],
      ['task-length', 15, 15],
      ['letter-form', 10, 10],
      ['vocabulary', 15, 20],
      ['grammar', 13, 25],
    ]);
    expect(criteriaPercent(all)).toBe(83);
  });
});
