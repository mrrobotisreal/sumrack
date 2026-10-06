import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import type { ExamResponse } from '@/db/repositories/exams';

import { gradeSpeakingOffline } from '../grading/speaking';
import {
  examScenarioRung,
  mergedSpeakingCriteria,
  speakingDebriefEntries,
  transcriptChips,
} from '../speaking/debrief-model';
import {
  drawTicket,
  monologueTickets,
  speakingPracticeEntries,
  speakingPracticeHref,
  ticketHref,
} from '../speaking/tickets-model';

/** T73: the pure debrief + practice / «Билеты» derivations over the fixture mock. */

const PACK = examPackJson as unknown as Pack;
const summaries = PACK.exams!.map((e) => ({
  packId: PACK.id,
  examId: e.id,
  mode: e.mode,
  titleRu: e.title.ru,
  titleEn: e.title.en,
  exam: ExamSchema.parse(e) as Exam,
}));
const EXAM = summaries.find((s) => s.examId === 'a1-mock-fx')!.exam!;
const SPEAKING = EXAM.subtests.find((s) => s.kind === 'speaking')!;

function response(itemId: string, over: Partial<ExamResponse> = {}): ExamResponse {
  const item = SPEAKING.parts.flatMap((p) => p.items).find((i) => i.id === itemId)!;
  const answer = {
    kind: item.kind as 'speaking-reply',
    transcript: 'я сейчас в москве',
    recordingPath: `t1-${itemId}.ogg`,
    durationMs: 2000,
  };
  const g = gradeSpeakingOffline(item, answer)!;
  return {
    id: `r-${itemId}`,
    attemptId: 'a1',
    subtestId: SPEAKING.id,
    itemId,
    answer,
    points: g.pct,
    maxPoints: 100,
    gradingStatus: 'provisional',
    grading: { v: 1, offline: { criteria: g.criteria, details: { ...g.details } } },
    durationMs: 2000,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('speakingDebriefEntries', () => {
  it('one entry per item; the monologue pair collapses to the answered topic (or the first, marked unchosen)', () => {
    const none = speakingDebriefEntries(EXAM, SPEAKING.id, []);
    expect(none.map((e) => [e.item.id, e.task, e.number, e.unchosen])).toEqual([
      ['sp01', 1, 1, false],
      ['sp02', 2, 2, false],
      ['sp03', 3, 3, true],
    ]);
    expect(none[0]!.modelLine).toBe('Я сейчас в Москве.');
    expect(none[2]!.modelLine).toBeNull();
    expect(none[0]!.pct).toBeNull();
    const withMono = speakingDebriefEntries(EXAM, SPEAKING.id, [response('sp04')]);
    expect(withMono[2]!.item.id).toBe('sp04');
    expect(withMono[2]!.unchosen).toBe(false);
  });

  it('a graded reply: pct from points/max, the offline details, criteria merged with grammar pending', () => {
    const [e] = speakingDebriefEntries(EXAM, SPEAKING.id, [response('sp01')]);
    expect(e!.pct).toBe(100);
    expect(e!.details?.task).toBe(1);
    expect(e!.criteria.map((c) => [c.id, c.pending, c.source])).toEqual([
      ['task-response', false, 'offline'],
      ['completeness', false, 'offline'],
      ['grammar', true, 'offline'],
    ]);
    expect(transcriptChips(e!.answer)).toEqual(['я', 'сейчас', 'в', 'москве']);
    expect(transcriptChips({ ...e!.answer!, words: [{ w: 'Я', s: 0, e: 1 }] })).toEqual(['Я']);
  });

  it('scored by AI → the AI rows replace the offline ones', () => {
    const r = response('sp01', {
      gradingStatus: 'scored',
      grading: {
        v: 1,
        ai: {
          criteria: [
            { id: 'task-response', score: 55, max: 60, comment: 'ok' },
            { id: 'completeness', score: 20, max: 20 },
            { id: 'grammar', score: 16, max: 20 },
          ],
          tips: [],
        },
      },
    });
    const m = mergedSpeakingCriteria(1, r);
    expect(m.map((c) => [c.id, c.score, c.source, c.pending])).toEqual([
      ['task-response', 55, 'ai', false],
      ['completeness', 20, 'ai', false],
      ['grammar', 16, 'ai', false],
    ]);
    expect(mergedSpeakingCriteria(3, null).map((c) => c.id)).toEqual([
      'coverage',
      'length',
      'fluency',
      'lexis-grammar',
    ]);
  });

  it('examScenarioRung finds the «Экзамен» family by id or pack slug', () => {
    const rung = { id: 'exam-a1', packId: 'a1-scn-exam-001' } as never;
    expect(examScenarioRung([{ familyId: 'exam', rungs: [rung] } as never])).toEqual({
      packId: 'a1-scn-exam-001',
      scenarioId: 'exam-a1',
    });
    expect(
      examScenarioRung([
        { familyId: 'podcast', rungs: [{ id: 'p', packId: 'a1-scn-podcast-001' }] } as never,
      ]),
    ).toBeNull();
    expect(examScenarioRung(undefined)).toBeNull();
  });
});

describe('speaking practice + tickets', () => {
  it('practice lists task-1 / task-2 items (drills first, then mocks); the href carries the item', () => {
    const entries = speakingPracticeEntries(summaries);
    expect(entries.map((e) => [e.examId, e.item.id])).toEqual([
      ['a1-mock-fx', 'sp01'],
      ['a1-mock-fx', 'sp02'],
    ]);
    expect(speakingPracticeHref(entries[0]!)).toEqual({
      pathname: '/torfl/speak',
      params: { packId: PACK.id, examId: 'a1-mock-fx', itemId: 'sp01' },
    });
    expect(ticketHref()).toEqual({ pathname: '/torfl/tickets' });
  });

  it('tickets = every monologue item with its answered count; the draw is weighted to the least practised', () => {
    const counts = new Map([[`${PACK.id}:a1-mock-fx:sp03`, 3]]);
    const tickets = monologueTickets(summaries, counts);
    expect(tickets.map((t) => [t.item.id, t.answered])).toEqual([
      ['sp03', 3],
      ['sp04', 0],
    ]);
    // weights 1/4 and 1 → sp04 wins everything from 0.2 of the total upward
    expect(drawTicket(tickets, () => 0.1)!.item.id).toBe('sp03');
    expect(drawTicket(tickets, () => 0.3)!.item.id).toBe('sp04');
    expect(drawTicket(tickets, () => 0.999)!.item.id).toBe('sp04');
    expect(drawTicket([], () => 0)).toBeNull();
    expect(monologueTickets([{ ...summaries[0]!, exam: null }])).toEqual([]);
  });
});
