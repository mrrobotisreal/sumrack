import { ExamSchema, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  ExamAnswerSchema,
  ExamAttemptStateSchema,
  ExamGradingSchema,
  ExamResultsSchema,
  examItemKey,
  findExamItem,
  initialAttemptState,
  isAnswered,
  subtestItemCount,
} from '../model';

const PACK = examPackJson as unknown as Pack;
const mock = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));

describe('torfl model (T68 JSON contracts)', () => {
  it('initialAttemptState parses and covers every subtest in order', () => {
    const state = initialAttemptState(mock.subtests);
    expect(ExamAttemptStateSchema.parse(state)).toEqual(state);
    expect(state.subtests.map((s) => s.id)).toEqual(mock.subtests.map((s) => s.id));
  });

  it('attempt state keeps unknown engine fields (looseObject) and defaults counters', () => {
    const parsed = ExamAttemptStateSchema.parse({
      v: 1,
      subtests: [],
      current: 0,
      phase: 'break',
      engineExtra: { x: 1 },
    });
    expect(parsed).toMatchObject({ playCounts: {}, flagged: [], engineExtra: { x: 1 } });
    expect(
      ExamAttemptStateSchema.safeParse({ v: 1, subtests: [], current: -1, phase: 'x' }).success,
    ).toBe(false);
  });

  it('answers discriminate by item kind', () => {
    expect(ExamAnswerSchema.parse({ kind: 'choice', index: null })).toEqual({
      kind: 'choice',
      index: null,
    });
    expect(
      ExamAnswerSchema.parse({
        kind: 'speaking-monologue',
        transcript: 'я живу в москве',
        recordingPath: 'att/sp03.ogg',
        durationMs: 120000,
      }).kind,
    ).toBe('speaking-monologue');
    expect(ExamAnswerSchema.safeParse({ kind: 'writing' }).success).toBe(false);
    expect(ExamAnswerSchema.safeParse({ kind: 'essay', text: '' }).success).toBe(false);
    expect(isAnswered({ kind: 'choice', index: null })).toBe(false);
    expect(isAnswered({ kind: 'typed', text: '  ' })).toBe(false);
    expect(isAnswered({ kind: 'writing', text: 'Привет' })).toBe(true);
  });

  it('results + grading schemas validate their ranges', () => {
    expect(
      ExamResultsSchema.safeParse({
        lexgram: { points: 50, maxPoints: 70, pct: 71.4, provisional: false, gradedBy: 'offline' },
      }).success,
    ).toBe(true);
    expect(
      ExamResultsSchema.safeParse({
        lexgram: { points: 50, maxPoints: 70, pct: 171, provisional: false, gradedBy: 'offline' },
      }).success,
    ).toBe(false);
    expect(ExamGradingSchema.safeParse({ v: 1 }).success).toBe(true);
    expect(
      ExamGradingSchema.safeParse({
        v: 1,
        ai: { criteria: [{ id: 'g', score: 1, max: 0 }], tips: [] },
      }).success,
    ).toBe(false);
  });

  it('findExamItem locates items and returns null for removed ones (§12)', () => {
    expect(findExamItem(mock, 'rd02')).toMatchObject({
      subtest: { kind: 'reading' },
      itemIdx: 1,
    });
    expect(findExamItem(mock, 'rd02', 'lexgram')).toBeNull();
    expect(findExamItem(mock, 'gone')).toBeNull();
    expect(mock.subtests.map(subtestItemCount)).toEqual([1, 5, 3, 3, 4]);
    expect(examItemKey('p', 'e', 'i')).toBe('p:e:i');
  });
});
