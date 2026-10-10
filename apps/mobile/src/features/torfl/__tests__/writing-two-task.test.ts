import { ExamSchema, type Exam } from '@sumrak/schema';
import a1Pack from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import a2Pack from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { describe, expect, it, vi } from 'vitest';

import { scoreWritingSubtest } from '../engine/finish';
import { recomputeResults, type GradingJobInput } from '../grading/queue-core';
import { criterionLabel, gradeWritingOffline, offlineItemScore } from '../grading/writing';
import { writingGrader } from '../grading/writing-grader';
import type { ExamAnswer, ExamGrading } from '../model';
import {
  countersLine,
  isNoteTopic,
  writingCounters,
  writingItemsOf,
  writingShare,
} from '../writing/writing-model';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

const exams = (pack: unknown): Exam[] =>
  (pack as { exams: unknown[] }).exams.map((e) => ExamSchema.parse(e));
const A1 = exams(a1Pack).find((e) => e.id === 'a1-mock-fx')!;
const A2 = exams(a2Pack).find((e) => e.id === 'a2-mock-fx')!;
const wr = (e: Exam) => e.subtests.find((s) => s.kind === 'writing')!;

const LETTER =
  'Привет, Саша!\nЯ закончил курс русского языка. Курс был в Денвере. Я учил русский шесть месяцев. Преподаватель был очень добрый. Самым трудным были падежи. Мне понравились фильмы. Хочешь тоже учиться? Как дела? Что нового? Когда мы увидимся?\nПока!';
const NOTE =
  'Привет! Давай встретимся в субботу. Я работаю в пятницу. Встретимся в пять часов вечера. Жду тебя в кафе.';

describe('writingShare (T76: points split equally)', () => {
  it('A1 single letter keeps the whole subtest; A2 splits 50 / 50', () => {
    expect(writingItemsOf(wr(A1))).toHaveLength(1);
    expect(writingShare(wr(A1))).toBe(wr(A1).maxPoints);
    expect(writingItemsOf(wr(A2))).toHaveLength(2);
    expect(writingShare(wr(A2))).toBe(50);
  });

  it('scoreWritingSubtest: 1 item ≡ before; 2 items sum to at most maxPoints', () => {
    const st = wr(A2);
    const answers: Record<string, ExamAnswer> = {
      wr01: { kind: 'writing', text: LETTER },
      wr02: { kind: 'writing', text: NOTE },
    };
    const r = scoreWritingSubtest(st, answers);
    const l = gradeWritingOffline(st.parts[0]!.items[0] as never, LETTER).pct;
    const n = gradeWritingOffline(st.parts[1]!.items[0] as never, NOTE).pct;
    expect(r.points).toBeCloseTo(Math.round(((l / 100) * 50 + (n / 100) * 50) * 10) / 10, 1);
    expect(r.maxPoints).toBe(100);
    expect(r.pct).toBeLessThanOrEqual(100);
    const a1 = scoreWritingSubtest(wr(A1), { wr01: { kind: 'writing', text: LETTER } });
    expect(a1.points).toBeCloseTo(
      (gradeWritingOffline(wr(A1).parts[0]!.items[0] as never, LETTER).pct / 100) * 100,
      0,
    );
  });
});

describe('recomputeResults with two writing rows', () => {
  const st = wr(A2);
  const offline = (item: string, text: string): ExamGrading => {
    const it = st.parts.flatMap((p) => p.items).find((i) => i.id === item) as never;
    const g = gradeWritingOffline(it, text);
    return { v: 1, offline: { criteria: g.criteria, details: { ...g.details } } };
  };
  const ai = (g: ExamGrading, pct: number): ExamGrading => ({
    ...g,
    ai: {
      criteria: [{ id: 'task-points', score: pct, max: 100 }],
      corrected: '',
      changes: [],
      tips: [],
      provider: 'x',
      model: 'm',
      quality: 'normal',
      effort: 'high',
      gradedAt: 1,
    },
  });
  const row = (itemGrading: ExamGrading, status: string, points: number) => ({
    subtestId: st.id,
    points,
    maxPoints: 50,
    gradingStatus: status,
    grading: itemGrading,
  });

  it('both offline: provisional, points sum over the subtest max (never doubled)', () => {
    const r = recomputeResults(
      A2,
      null,
      [
        row(offline('wr01', LETTER), 'provisional', 40),
        row(offline('wr02', NOTE), 'provisional', 45),
      ],
      'full',
    );
    expect(r.results[st.id]).toMatchObject({
      points: 85,
      maxPoints: 100,
      pct: 85,
      provisional: true,
      gradedBy: 'offline',
    });
  });

  it('one AI + one offline: still provisional', () => {
    const r = recomputeResults(
      A2,
      null,
      [
        row(ai(offline('wr01', LETTER), 90), 'scored', 45),
        row(offline('wr02', NOTE), 'provisional', 20),
      ],
      'full',
    );
    expect(r.results[st.id]).toMatchObject({ points: 65, pct: 65, provisional: true });
  });

  it('one AI + one AI-failed: provisional, failed row keeps its offline points', () => {
    const r = recomputeResults(
      A2,
      null,
      [
        row(ai(offline('wr01', LETTER), 90), 'scored', 45),
        row(offline('wr02', NOTE), 'ai-failed', 30),
      ],
      'full',
    );
    expect(r.results[st.id]).toMatchObject({ points: 75, provisional: true });
  });

  it('both AI: final, 50 / 50', () => {
    const r = recomputeResults(
      A2,
      null,
      [
        row(ai(offline('wr01', LETTER), 100), 'scored', 50),
        row(ai(offline('wr02', NOTE), 100), 'scored', 50),
      ],
      'full',
    );
    expect(r.results[st.id]).toMatchObject({
      points: 100,
      pct: 100,
      provisional: false,
      gradedBy: 'ai',
    });
  });
});

describe('writingGrader.fold scales by the row maxPoints', () => {
  it('a 50-point row: pct 80 → 40', () => {
    const job = { maxPoints: 50, grading: null } as unknown as GradingJobInput;
    const grade = {
      criteria: [
        { id: 'task-points', score: 24, max: 30 },
        { id: 'task-length', score: 12, max: 15 },
        { id: 'letter-form', score: 8, max: 10 },
        { id: 'vocabulary', score: 16, max: 20 },
        { id: 'grammar', score: 20, max: 25 },
      ],
      corrected: 'x',
      changes: [],
      tips: [],
    };
    const w = writingGrader.fold({ exam: A2, job, storyText: async () => null }, grade as never, {
      provider: 'p',
      model: 'm',
      quality: 'normal',
      effort: 'high',
      gradedAt: 1,
      ms: 1,
    });
    expect(w.pct).toBe(80);
    expect(w.points).toBe(40);
  });
});

describe('write-note (T76)', () => {
  const note = wr(A2).parts[1]!.items[0] as never as Parameters<typeof gradeWritingOffline>[0];
  it('topic-aware form: greeting OR sign-off earns the whole row', () => {
    const greetOnly = gradeWritingOffline(note, 'Привет! Давай встретимся в субботу.');
    const form = (g: ReturnType<typeof gradeWritingOffline>) =>
      g.criteria.find((c) => c.id === 'letter-form')!.score;
    expect(form(greetOnly)).toBe(10);
    expect(form(gradeWritingOffline(note, 'Давай встретимся в субботу. Пока!'))).toBe(10);
    expect(form(gradeWritingOffline(note, 'Давай встретимся в субботу.'))).toBe(0);
    // a letter still needs both halves
    const letterItem = wr(A2).parts[0]!.items[0] as never as Parameters<
      typeof gradeWritingOffline
    >[0];
    expect(form(gradeWritingOffline(letterItem, 'Привет! Я учил русский.'))).toBe(5);
  });
  it('bullets carry the content through the cue matcher', () => {
    const g = gradeWritingOffline(note, NOTE);
    expect(g.details.pointsCovered).toBe(4);
    expect(g.pct).toBeGreaterThan(80);
    const bare = gradeWritingOffline(note, 'Привет!');
    expect(bare.details.pointsCovered).toBe(0);
  });
  it('counter copy has no question quota for a note; the letter line is unchanged', () => {
    const c = writingCounters(note, 'Привет. Давай.');
    expect(countersLine(c, 'write-note')).toBe('Предложений: 2 / ≥ 5');
    expect(countersLine(c, 'write-letter')).toContain('Вопросов');
    expect(countersLine(c)).toContain('Вопросов');
    expect(isNoteTopic('write-note')).toBe(true);
  });
  it('labels the form row per topic', () => {
    expect(criterionLabel('letter-form').ru).toBe('Форма письма');
    expect(criterionLabel('letter-form', 'write-note').ru).toBe('Форма записки');
    expect(criterionLabel('grammar', 'write-note').ru).toBe(criterionLabel('grammar').ru);
  });
  it('offlineItemScore over a 50-point row', () => {
    const g = gradeWritingOffline(note, NOTE);
    expect(offlineItemScore(g, 50).points).toBeCloseTo((g.pct / 100) * 50, 1);
  });
});
