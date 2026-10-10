import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import a2Pack from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import {
  writingPracticeEntries,
  writingPracticeGroups,
  writingPracticeHref,
} from '../writing/writing-practice-model';
import { mergedCriteria } from '../writing/review-model';

const PACK = examPackJson as unknown as Pack;
const summaries = PACK.exams!.map((e) => ({
  packId: PACK.id,
  examId: e.id,
  mode: e.mode,
  titleRu: e.title.ru,
  titleEn: e.title.en,
  exam: ExamSchema.parse(e) as Exam,
}));

describe('writing practice catalog', () => {
  it('lists every writing item (the fixture mock has one; the drill none), drills before mocks', () => {
    const entries = writingPracticeEntries(summaries);
    expect(entries.map((e) => [e.examId, e.item.id, e.mode])).toEqual([
      ['a1-mock-fx', 'wr01', 'mock'],
    ]);
    expect(writingPracticeHref(entries[0]!)).toEqual({
      pathname: '/torfl/writing',
      params: { packId: PACK.id, examId: 'a1-mock-fx', itemId: 'wr01' },
    });
  });
  it('an unreadable exam is skipped', () => {
    expect(writingPracticeEntries([{ ...summaries[1]!, exam: null }])).toEqual([]);
  });
});

describe('mergedCriteria', () => {
  const offline = [
    { id: 'task-points', score: 22.5, max: 30 },
    { id: 'task-length', score: 4, max: 15 },
    { id: 'letter-form', score: 5, max: 10 },
  ];
  it('provisional: three offline rows + two pending AI-only rows', () => {
    const rows = mergedCriteria({
      gradingStatus: 'provisional',
      grading: { v: 1, offline: { criteria: offline } },
    });
    expect(rows.map((r) => [r.id, r.source, r.pending])).toEqual([
      ['task-points', 'offline', false],
      ['task-length', 'offline', false],
      ['letter-form', 'offline', false],
      ['vocabulary', 'offline', true],
      ['grammar', 'offline', true],
    ]);
  });
  it('scored: the AI rows win; self-graded: the self rows', () => {
    const ai = [
      { id: 'task-points', score: 26, max: 30, comment: 'ok' },
      { id: 'task-length', score: 15, max: 15 },
      { id: 'letter-form', score: 10, max: 10 },
      { id: 'vocabulary', score: 18.5, max: 20 },
      { id: 'grammar', score: 25, max: 25 },
    ];
    const rows = mergedCriteria({
      gradingStatus: 'scored',
      grading: { v: 1, offline: { criteria: offline }, ai: { criteria: ai, tips: [] } },
    });
    expect(rows.every((r) => r.source === 'ai' && !r.pending)).toBe(true);
    expect(rows[0]!.comment).toBe('ok');
    const self = mergedCriteria({
      gradingStatus: 'self-graded',
      grading: { v: 1, offline: { criteria: offline }, self: { criteria: ai } },
    });
    expect(self.every((r) => r.source === 'self')).toBe(true);
  });
});

describe('writingPracticeGroups (T76)', () => {
  it('A1: one flat letter group with no header', () => {
    const groups = writingPracticeGroups(writingPracticeEntries(summaries));
    expect(groups.map((g) => [g.key, g.titleRu, g.entries.length])).toEqual([['letter', null, 1]]);
  });
  it('A2: Письмо then Записка', () => {
    const a2 = (a2Pack as unknown as Pack).exams!.map((e) => ({
      packId: 'a2-exam-fixture',
      examId: e.id,
      mode: e.mode,
      titleRu: e.title.ru,
      titleEn: e.title.en,
      exam: ExamSchema.parse(e) as Exam,
    }));
    const groups = writingPracticeGroups(writingPracticeEntries(a2));
    expect(groups.map((g) => [g.key, g.titleRu])).toEqual([
      ['letter', 'Письмо'],
      ['note', 'Записка'],
    ]);
    expect(groups[1]!.entries[0]!.item.id).toBe('wr02');
  });
});
