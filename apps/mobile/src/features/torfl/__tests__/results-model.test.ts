import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import type { ExamAnswer } from '../model';
import {
  buildResultRows,
  formatUsed,
  missingVerdictLine,
  outcomeCounts,
  pctsFromRows,
  provisionalFromRows,
  reviewEntries,
  topicBreakdown,
} from '../results-model';
import { verdict } from '../verdict';

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const choice = (index: number | null): ExamAnswer => ({ kind: 'choice', index });

const attempt = {
  scope: 'full',
  subtestIds: EXAM.subtests.map((s) => s.id),
  results: {
    lexgram: { points: 4, maxPoints: 5, pct: 80, provisional: false, gradedBy: 'offline' as const },
    reading: {
      points: 8,
      maxPoints: 12,
      pct: 66.7,
      provisional: false,
      gradedBy: 'offline' as const,
    },
    listening: {
      points: 5,
      maxPoints: 15,
      pct: 33.3,
      provisional: false,
      gradedBy: 'offline' as const,
    },
  },
  state: {
    subtests: [
      { id: 'writing', kind: 'writing', status: 'submitted', skipped: true },
      { id: 'lexgram', kind: 'lexgram', status: 'submitted', timeUsedSec: 1200 },
      {
        id: 'reading',
        kind: 'reading',
        status: 'submitted',
        timeUsedSec: 2400,
        autoSubmitted: true,
      },
      { id: 'listening', kind: 'listening', status: 'submitted', timeUsedSec: 900 },
      { id: 'speaking', kind: 'speaking', status: 'submitted', skipped: true },
    ],
  },
};

describe('buildResultRows', () => {
  it('five rows in exam order: three scored, writing + speaking «пропущено»; time + auto flags', () => {
    const rows = buildResultRows(EXAM, attempt);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['writing', 'skipped'],
      ['lexgram', 'scored'],
      ['reading', 'scored'],
      ['listening', 'scored'],
      ['speaking', 'skipped'],
    ]);
    expect(rows[2]).toMatchObject({ pct: 66.7, autoSubmitted: true, timeUsedSec: 2400 });
    expect(rows[0]!.pct).toBeNull();
  });

  it('a single-subtest attempt shows only that subtest', () => {
    const rows = buildResultRows(EXAM, {
      ...attempt,
      scope: 'subtest',
      subtestIds: ['reading'],
    });
    expect(rows.map((r) => r.kind)).toEqual(['reading']);
  });

  it('a subtest never reached is pending', () => {
    const rows = buildResultRows(EXAM, {
      scope: 'full',
      subtestIds: ['lexgram'],
      results: null,
      state: { subtests: [{ id: 'lexgram', kind: 'lexgram', status: 'running' }] },
    });
    expect(rows[0]!.status).toBe('pending');
  });
});

describe('the results card variants (five injected pcts → each verdict variant)', () => {
  const five = (n: number, over: Record<string, number> = {}) =>
    buildResultRows(EXAM, {
      scope: 'full',
      subtestIds: EXAM.subtests.map((s) => s.id),
      results: Object.fromEntries(
        EXAM.subtests.map((s) => [
          s.id,
          {
            points: 0,
            maxPoints: s.maxPoints,
            pct: over[s.kind] ?? n,
            provisional: s.kind === 'writing',
            gradedBy: 'offline' as const,
          },
        ]),
      ),
      state: {
        subtests: EXAM.subtests.map((s) => ({ id: s.id, kind: s.kind, status: 'submitted' })),
      },
    });

  it('pass / borderline / fail / provisional / missing', () => {
    expect(verdict(pctsFromRows(five(70)), {}).verdict).toBe('pass');
    expect(verdict(pctsFromRows(five(70, { reading: 62 }))).verdict).toBe('pass-borderline');
    const fail = verdict(pctsFromRows(five(70, { speaking: 40 })));
    expect(fail).toMatchObject({ verdict: 'fail', retake: ['speaking'] });
    expect(verdict(pctsFromRows(five(70)), provisionalFromRows(five(70))).provisional).toBe(true);
    const three = verdict(pctsFromRows(buildResultRows(EXAM, attempt)));
    expect(three.verdict).toBeNull();
    expect(missingVerdictLine(three.missing)).toBe('Вердикт — после Письма и Говорения');
  });
});

describe('missingVerdictLine', () => {
  it('genitive list', () => {
    expect(missingVerdictLine(['writing'])).toBe('Вердикт — после Письма');
    expect(missingVerdictLine(['writing', 'reading', 'speaking'])).toBe(
      'Вердикт — после Письма, Чтения и Говорения',
    );
    expect(missingVerdictLine([])).toBe('');
  });
});

describe('topicBreakdown', () => {
  it('per topic over scored objective subtests, weakest first; unanswered counts as not correct', () => {
    const answers: Record<string, ExamAnswer> = {
      rd01: choice(0), // right (answer 0)
      rd02: choice(0), // wrong (answer 1)
    };
    const t = topicBreakdown(EXAM, ['reading'], answers);
    expect(t).toEqual([
      { topic: 'read-detail', kind: 'reading', correct: 1, total: 3, accuracy: 1 / 3 },
    ]);
    expect(topicBreakdown(EXAM, [], answers)).toEqual([]);
  });
});

describe('reviewEntries', () => {
  it('chosen vs correct, outcome, explain + audio story inheritance for listening', () => {
    const listening = EXAM.subtests.find((s) => s.id === 'listening')!;
    const entries = reviewEntries(listening, { ls01: choice(0), ls02: choice(1) });
    expect(entries).toHaveLength(3);
    const first = entries[0]!;
    expect(first.number).toBe(1);
    expect(first.outcome).toBe('wrong');
    expect(first.options.find((o) => o.chosen)?.letter).toBe('А');
    expect(first.options.find((o) => o.correct)?.letter).toBe('Б');
    expect(first.audioStoryId).toBe('ls-01');
    expect(entries[1]!.audioStoryId).toBe('ls-01'); // inherited from the part's first item
    expect(entries[2]!.outcome).toBe('blank');
    expect(outcomeCounts(entries)).toEqual({ full: 1, half: 0, wrong: 1, blank: 1 });
  });

  it('passage story id for reading', () => {
    const reading = EXAM.subtests.find((s) => s.id === 'reading')!;
    expect(reviewEntries(reading, {})[0]!.passageStoryId).toBe('rd-01');
  });
});

describe('formatUsed', () => {
  it('human time', () => {
    expect(formatUsed(null)).toBe('');
    expect(formatUsed(45)).toBe('45 с');
    expect(formatUsed(750)).toBe('12 мин 30 с');
    expect(formatUsed(3900)).toBe('1 ч 05 мин');
  });
});
