import { describe, expect, it } from 'vitest';

import {
  BAND_BAR_CLASS,
  bandFor,
  computeReadiness,
  drillEstimate,
  latestMockPcts,
  predictVerdict,
  predictedLine,
  recommendToday,
  weakestTopic,
  type MockAttemptLike,
  type ReadinessRow,
} from '../readiness';

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;

const rowsOf = (pcts: Record<string, number | null>): ReadinessRow[] =>
  computeReadiness({
    now: NOW,
    mocks: Object.fromEntries(
      Object.entries(pcts)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, { pct: v!, finishedAt: NOW - DAY, provisional: false }]),
    ),
    drills: {},
  });

describe('bands (§7.4)', () => {
  it('< 60 red · 60–66 amber · 66–80 green · ≥ 80 gold, inclusive at the lower edge', () => {
    expect(bandFor(59.9)).toBe('fail');
    expect(bandFor(60)).toBe('borderline');
    expect(bandFor(65.9)).toBe('borderline');
    expect(bandFor(66)).toBe('pass');
    expect(bandFor(79.9)).toBe('pass');
    expect(bandFor(80)).toBe('margin');
    expect(bandFor(100)).toBe('margin');
  });
  it('every band maps to a theme token class (no raw colours)', () => {
    expect(Object.values(BAND_BAR_CLASS).sort()).toEqual([
      'bg-danger',
      'bg-gold',
      'bg-success',
      'bg-track-warm',
    ]);
  });
});

describe('drill estimate with shrinkage', () => {
  it('(correct + 15) / (n + 30) × 100, one decimal', () => {
    expect(drillEstimate({ answered: 10, correct: 10 })).toBe(62.5);
    expect(drillEstimate({ answered: 10, correct: 0 })).toBe(37.5);
    expect(drillEstimate({ answered: 1, correct: 1 })).toBe(51.6);
    expect(drillEstimate({ answered: 200, correct: 180 })).toBe(84.8);
  });
  it('no responses → null (unknown), never a flat 50', () => {
    expect(drillEstimate(undefined)).toBeNull();
    expect(drillEstimate({ answered: 0, correct: 0 })).toBeNull();
  });
  it('a perfect streak needs many answers to cross the 66 line (shrinkage works)', () => {
    expect(drillEstimate({ answered: 5, correct: 5 })!).toBeLessThan(66);
    expect(drillEstimate({ answered: 30, correct: 30 })!).toBe(75);
  });
});

describe('computeReadiness', () => {
  it('prefers a mock within 21 days over drills, labelled with its age', () => {
    const rows = computeReadiness({
      now: NOW,
      mocks: { lexgram: { pct: 71.4, finishedAt: NOW - 3 * DAY, provisional: false } },
      drills: { lexgram: { answered: 50, correct: 10 } },
    });
    const lex = rows.find((r) => r.kind === 'lexgram')!;
    expect(lex).toMatchObject({ pct: 71.4, band: 'pass', source: 'mock', mockDaysAgo: 3 });
    expect(lex.label).toBe('пробный экзамен 3 дн. назад');
  });
  it('a mock older than 21 days falls back to the drill estimate', () => {
    const rows = computeReadiness({
      now: NOW,
      mocks: { lexgram: { pct: 90, finishedAt: NOW - 22 * DAY, provisional: false } },
      drills: { lexgram: { answered: 30, correct: 24 } },
    });
    const lex = rows.find((r) => r.kind === 'lexgram')!;
    expect(lex.source).toBe('estimate');
    expect(lex.pct).toBe(65);
    expect(lex.band).toBe('borderline');
    expect(lex.label).toContain('оценка по тренировкам');
  });
  it('exactly 21 days still counts; a provisional mock is labelled', () => {
    const rows = computeReadiness({
      now: NOW,
      mocks: { writing: { pct: 70, finishedAt: NOW - 21 * DAY, provisional: true } },
      drills: {},
    });
    const w = rows.find((r) => r.kind === 'writing')!;
    expect(w.source).toBe('mock');
    expect(w.provisional).toBe(true);
    expect(w.label).toContain('предварительно');
  });
  it('unknown with no mock and no responses; writing / speaking say «после пробного»', () => {
    const rows = computeReadiness({ now: NOW, mocks: {}, drills: {} });
    expect(rows.map((r) => r.kind)).toEqual([
      'writing',
      'lexgram',
      'reading',
      'listening',
      'speaking',
    ]);
    expect(rows.every((r) => r.pct === null && r.band === null && r.source === 'none')).toBe(true);
    expect(rows[0]!.label).toBe('появится после пробного экзамена');
    expect(rows[1]!.label).toBe('появится после первой тренировки');
  });
  it('same-day mock reads «сегодня»', () => {
    const rows = computeReadiness({
      now: NOW,
      mocks: { reading: { pct: 80, finishedAt: NOW - 1000, provisional: false } },
      drills: {},
    });
    expect(rows.find((r) => r.kind === 'reading')!.label).toBe('пробный экзамен сегодня');
  });
});

describe('latestMockPcts', () => {
  const attempt = (
    finishedAt: number,
    results: Record<string, number>,
    over: Partial<MockAttemptLike> = {},
  ): MockAttemptLike => ({
    status: 'finished',
    mode: 'mock',
    finishedAt,
    results: Object.fromEntries(
      Object.entries(results).map(([id, pct]) => [
        id,
        { points: pct, maxPoints: 100, pct, provisional: false, gradedBy: 'offline' as const },
      ]),
    ),
    state: {
      subtests: [
        { id: 'lex', kind: 'lexgram' },
        { id: 'read', kind: 'reading' },
      ],
    },
    ...over,
  });
  it('picks the newest finished MOCK per kind, mapping ids to kinds through the state', () => {
    const out = latestMockPcts([
      attempt(100, { lex: 50 }),
      attempt(300, { lex: 70, read: 80 }),
      attempt(200, { lex: 60 }),
    ]);
    expect(out.lexgram).toMatchObject({ pct: 70, finishedAt: 300 });
    expect(out.reading).toMatchObject({ pct: 80 });
  });
  it('ignores drills, unfinished attempts and unreadable results; accepts kind-named ids', () => {
    expect(latestMockPcts([attempt(1, { lex: 50 }, { mode: 'drill' })])).toEqual({});
    expect(latestMockPcts([attempt(1, { lex: 50 }, { status: 'abandoned' })])).toEqual({});
    expect(latestMockPcts([attempt(1, { lex: 50 }, { results: null })])).toEqual({});
    expect(latestMockPcts([attempt(5, { speaking: 62 }, { state: null })]).speaking?.pct).toBe(62);
    expect(latestMockPcts([attempt(5, { weird: 62 }, { state: null })])).toEqual({});
  });
});

describe('predictVerdict (local §6.3 copy)', () => {
  const all = (v: number) => ({ writing: v, lexgram: v, reading: v, listening: v, speaking: v });
  it('every ≥ 66 → pass; boundary 66 passes, 65.9 does not', () => {
    expect(predictVerdict(all(66))).toEqual({ verdict: 'pass', retake: [] });
    expect(predictVerdict({ ...all(70), reading: 65.9 }).verdict).toBe('pass-borderline');
  });
  it('exactly one in [60, 66) and four ≥ 66 → pass-borderline', () => {
    expect(predictVerdict({ ...all(75), listening: 60 })).toEqual({
      verdict: 'pass-borderline',
      retake: [],
    });
  });
  it('one under 60 → fail, retake lists it', () => {
    expect(predictVerdict({ ...all(75), listening: 59.9 })).toEqual({
      verdict: 'fail',
      retake: ['listening'],
    });
  });
  it('two borderlines → fail, only one borderline is «spent»', () => {
    const r = predictVerdict({ ...all(75), listening: 62, reading: 64 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['listening']); // reading (64) is the spent one
  });
  it('unknown counts as fail and is always in the retake list', () => {
    const r = predictVerdict({ lexgram: 80, reading: 80, listening: 80 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['writing', 'speaking']);
    expect(predictVerdict({}).retake).toHaveLength(5);
  });
});

describe('predictedLine', () => {
  it('words the three outcomes', () => {
    expect(
      predictedLine(rowsOf({ writing: 70, lexgram: 70, reading: 70, listening: 70, speaking: 70 }))
        .text,
    ).toBe('Сейчас: сдал бы');
    expect(
      predictedLine(rowsOf({ writing: 70, lexgram: 70, reading: 70, listening: 62, speaking: 70 }))
        .text,
    ).toContain('почти');
    const fail = predictedLine(
      rowsOf({ writing: 70, lexgram: 70, reading: 70, listening: 40, speaking: 70 }),
    );
    expect(fail.verdict).toBe('fail');
    expect(fail.text).toBe('Сейчас: пока нет — подтяни: Аудирование');
  });
  it('with nothing known it names up to three subtests', () => {
    const line = predictedLine(rowsOf({}));
    expect(line.verdict).toBe('fail');
    expect(line.text.split(',').length).toBeLessThanOrEqual(3);
  });
});

describe('weakestTopic + recommendToday', () => {
  const stats = [
    { topic: 'case-gen', answered: 10, correct: 4 },
    { topic: 'case-prep', answered: 10, correct: 9 },
    { topic: 'conj', answered: 2, correct: 0 }, // too few answers to judge
  ];
  const lexTopics = new Set(['case-gen', 'case-prep', 'conj']);
  it('weakest = lowest accuracy among topics with ≥ 3 answers', () => {
    expect(weakestTopic(stats, lexTopics)?.topic).toBe('case-gen');
    expect(weakestTopic(stats, new Set(['conj']))).toBeNull();
  });
  const base = {
    rows: rowsOf({ lexgram: 50, reading: 70, listening: 70 }),
    topicsByKind: { lexgram: lexTopics },
    topicStats: stats,
    deckDue: 0,
    lastMockAt: null,
    now: NOW,
    mockInstalled: true,
  };
  it('1. weakest topic of the weakest objective subtest under 66', () => {
    expect(recommendToday(base)).toEqual({
      kind: 'topic',
      subtestKind: 'lexgram',
      topic: 'case-gen',
      accuracy: 40,
    });
  });
  it('2. due deck items when no weak topic is nameable', () => {
    expect(recommendToday({ ...base, topicStats: [], deckDue: 7 })).toEqual({
      kind: 'deck',
      due: 7,
    });
  });
  it('3. «time for a mock» when none in 7 days and every objective subtest ≥ 60', () => {
    const rows = rowsOf({ lexgram: 70, reading: 70, listening: 70 });
    expect(recommendToday({ ...base, rows })).toEqual({ kind: 'mock' });
    expect(recommendToday({ ...base, rows, lastMockAt: NOW - 2 * DAY })?.kind).not.toBe('mock');
    expect(recommendToday({ ...base, rows, mockInstalled: false })?.kind).not.toBe('mock');
    // an unknown objective subtest blocks it
    expect(recommendToday({ ...base, rows: rowsOf({ lexgram: 70, reading: 70 }) })?.kind).not.toBe(
      'mock',
    );
  });
  it('4. falls back to the weakest topic anywhere, then the first drill', () => {
    const rows = rowsOf({ lexgram: 70, reading: 70, listening: 70 });
    expect(recommendToday({ ...base, rows, lastMockAt: NOW })).toMatchObject({
      kind: 'topic',
      topic: 'case-gen',
    });
    expect(recommendToday({ ...base, rows, lastMockAt: NOW, topicStats: [] })).toEqual({
      kind: 'start',
      subtestKind: 'lexgram',
    });
    expect(recommendToday({ ...base, topicsByKind: {}, topicStats: [] })).toBeNull();
  });
});
