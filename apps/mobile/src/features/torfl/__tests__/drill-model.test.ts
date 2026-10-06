import { ExamSchema, type Exam } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  WEAK_TOPIC_WEIGHT,
  drillEntriesFromExam,
  drillIdentity,
  entryForDeckCard,
  pickLightning,
  summarizeDrill,
  weakestTopics,
  type DrillEntry,
  type DrillResult,
} from '../drill/drill-model';

const PACK = examPackJson as unknown as { id: string; exams: unknown[] };
const EXAMS: Exam[] = PACK.exams.map((e) => ExamSchema.parse(e));
const drill = EXAMS.find((e) => e.mode === 'drill')!;
const mock = EXAMS.find((e) => e.mode === 'mock')!;

describe('drillEntriesFromExam', () => {
  it('serves every objective item of a drill in authored order', () => {
    const q = drillEntriesFromExam(drill, PACK.id);
    expect(q.entries.map((e) => e.item.id)).toEqual([
      'dr01',
      'dr02',
      'dr03',
      'dr04',
      'dr05',
      'dr06',
    ]);
    expect(q.entries[0]!.itemKey).toBe(`${PACK.id}:${drill.id}:dr01`);
    expect(q.skipped).toEqual({ writing: 0, speaking: 0 });
  });
  it('filters by topic, and skips + counts writing / speaking items', () => {
    expect(drillEntriesFromExam(drill, PACK.id, { topic: 'nope' }).entries).toHaveLength(0);
    const q = drillEntriesFromExam(mock, PACK.id);
    expect(q.entries.map((e) => e.subtest.kind)).toEqual([
      ...Array(5).fill('lexgram'),
      ...Array(3).fill('reading'),
      ...Array(3).fill('listening'),
    ]);
    expect(q.skipped).toEqual({ writing: 1, speaking: 4 });
    const reading = drillEntriesFromExam(mock, PACK.id, { topic: 'read-detail' });
    expect(reading.entries).toHaveLength(3);
    expect(reading.skipped).toEqual({ writing: 0, speaking: 0 });
  });
  it('keeps part + index so listening items can inherit their part audio', () => {
    const q = drillEntriesFromExam(mock, PACK.id, { topic: 'listen-detail' });
    expect(q.entries[1]!.itemIdx).toBe(1);
    expect(q.entries[1]!.part.items).toHaveLength(3);
  });
});

describe('entryForDeckCard', () => {
  it('resolves a card to its item in the current exam; null when removed / exam missing', () => {
    const hit = entryForDeckCard({ packId: PACK.id, examId: drill.id, itemId: 'dr03' }, drill);
    expect(hit?.item.id).toBe('dr03');
    expect(
      entryForDeckCard({ packId: PACK.id, examId: drill.id, itemId: 'gone' }, drill),
    ).toBeNull();
    expect(
      entryForDeckCard({ packId: PACK.id, examId: drill.id, itemId: 'dr03' }, null),
    ).toBeNull();
  });
  it('a non-objective item is not servable', () => {
    expect(entryForDeckCard({ packId: PACK.id, examId: mock.id, itemId: 'wr01' }, mock)).toBeNull();
  });
});

describe('weakestTopics + pickLightning', () => {
  const stats = [
    { topic: 'a', answered: 10, correct: 9 },
    { topic: 'b', answered: 10, correct: 2 },
    { topic: 'c', answered: 4, correct: 1 },
    { topic: 'd', answered: 10, correct: 5 },
    { topic: 'e', answered: 0, correct: 0 },
  ];
  it('the 3 lowest-accuracy topics with answers', () => {
    expect(weakestTopics(stats)).toEqual(['b', 'c', 'd']);
    expect(weakestTopics([])).toEqual([]);
  });

  const fake = (id: string, topic: string): DrillEntry =>
    ({
      packId: 'p',
      examId: 'e',
      subtest: { id: 'lex', kind: 'lexgram' },
      part: { items: [] },
      partIdx: 0,
      itemIdx: 0,
      item: { id, topic, kind: 'choice' },
      itemKey: `p:e:${id}`,
    }) as unknown as DrillEntry;
  const pool = [
    ...Array.from({ length: 30 }, (_, i) => fake(`w${i}`, 'b')),
    ...Array.from({ length: 30 }, (_, i) => fake(`s${i}`, 'a')),
  ];
  it('draws 20 distinct items by default, lexgram only', () => {
    const out = pickLightning(pool, stats, Math.random);
    expect(out).toHaveLength(20);
    expect(new Set(out.map((e) => e.item.id)).size).toBe(20);
    const reading = {
      ...fake('r', 'x'),
      subtest: { id: 'rd', kind: 'reading' },
    } as unknown as DrillEntry;
    expect(pickLightning([reading], stats)).toHaveLength(0);
  });
  it('is weighted toward the weakest topics (3×) — deterministic rng', () => {
    // weak (b) items occupy the first 30 slots of 30·3 + 30·1 = 120 weight → first 90 of r·total are weak
    const first = pickLightning(pool, stats, () => 0.0, 1)[0]!;
    expect(first.item.topic).toBe('b');
    const last = pickLightning(pool, stats, () => 0.999, 1)[0]!;
    expect(last.item.topic).toBe('a');
    expect(WEAK_TOPIC_WEIGHT).toBe(3);
    // statistically: ~75 % of the first picks are weak
    let seed = 7;
    const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let weak = 0;
    for (let i = 0; i < 400; i++)
      if (pickLightning(pool, stats, rng, 1)[0]!.item.topic === 'b') weak += 1;
    expect(weak / 400).toBeGreaterThan(0.65);
    expect(weak / 400).toBeLessThan(0.85);
  });
  it('fewer candidates than the count → all of them; no stats → uniform', () => {
    expect(pickLightning(pool.slice(0, 5), [], Math.random)).toHaveLength(5);
  });
});

describe('summarizeDrill', () => {
  const r = (topic: string, outcome: DrillResult['outcome'], ms = 1000): DrillResult => ({
    itemKey: `k:${topic}:${outcome}`,
    itemId: 'i',
    topic,
    subtestKind: 'lexgram',
    outcome,
    ms,
  });
  it('accuracy, half credit, deck count, per-topic table (weakest first)', () => {
    const s = summarizeDrill([
      r('case-gen', 'full'),
      r('case-gen', 'wrong'),
      r('case-prep', 'full'),
      r('case-prep', 'half'),
      r('conj', 'blank'),
    ]);
    expect(s).toMatchObject({
      answered: 5,
      correct: 2,
      half: 1,
      accuracyPct: 40,
      toDeck: 3,
      totalMs: 5000,
    });
    expect(s.perTopic.map((t) => [t.topic, t.pct])).toEqual([
      ['conj', 0],
      ['case-gen', 50],
      ['case-prep', 50],
    ]);
    expect(s.perTopic[1]!.ru).toBe('Родительный');
  });
  it('an empty session is all zeros', () => {
    expect(summarizeDrill([])).toMatchObject({
      answered: 0,
      accuracyPct: 0,
      toDeck: 0,
      perTopic: [],
    });
  });
});

describe('drillIdentity (analytics slugs only)', () => {
  it('set → the exam ids + topic; deck / lightning → mixed ids, kind when single', () => {
    const q = drillEntriesFromExam(drill, PACK.id);
    expect(
      drillIdentity('set', q.entries, { packId: PACK.id, examId: drill.id, topic: 'case-prep' }),
    ).toEqual({
      packId: PACK.id,
      examId: drill.id,
      subtestKind: 'lexgram',
      topic: 'case-prep',
      source: 'set',
    });
    const mixed = drillEntriesFromExam(mock, PACK.id).entries;
    expect(drillIdentity('deck', mixed, {})).toEqual({
      packId: 'mixed',
      examId: 'deck',
      subtestKind: 'mixed',
      topic: 'all',
      source: 'deck',
    });
  });
});
