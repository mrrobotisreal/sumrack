import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import a2PackJson from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { importPack } from '@/db/importer';
import { createRepositories } from '@/db/repositories';
import { DAILY_DECK_MAX } from '@/features/torfl/drill/drill-model';
import { levelOrder } from '@/features/torfl/levels-today';

import { DEFAULT_DAILY_PREFS, parseDailyPrefs, torflSegmentEnabled } from '../prefs';
import { buildDailySession, buildTorflSegment } from '../session';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

/**
 * T70: the daily session's optional TORFL segment — on iff an exam date is
 * set (an explicit toggle overrides), ≤ 10 due deck items, resolved against
 * the current exams, never touching `cards`.
 */

const PACK = examPackJson as unknown as Pack;
const A2_PACK = a2PackJson as unknown as Pack;
const T0 = 1_790_000_000_000;

describe('torflSegmentEnabled / prefs', () => {
  it('auto = on iff an exam date is set; an explicit value wins', () => {
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, null)).toBe(false);
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, '2026-12-01')).toBe(true);
    expect(torflSegmentEnabled({ ...DEFAULT_DAILY_PREFS, torfl: false }, '2026-12-01')).toBe(false);
    expect(torflSegmentEnabled({ ...DEFAULT_DAILY_PREFS, torfl: true }, null)).toBe(true);
  });
  it('T75: the A2 date alone turns the segment on (auto); no dates is off; explicit true is on', () => {
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, { A1: null, A2: '2026-12-01' })).toBe(true);
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, { A1: null, A2: null })).toBe(false);
    expect(
      torflSegmentEnabled({ ...DEFAULT_DAILY_PREFS, torfl: true }, { A1: null, A2: null }),
    ).toBe(true);
  });
  it('the stored prefs accept the optional torfl flag and still heal garbage', () => {
    expect(parseDailyPrefs({ ...DEFAULT_DAILY_PREFS, torfl: true }).torfl).toBe(true);
    expect(parseDailyPrefs(DEFAULT_DAILY_PREFS)).toEqual(DEFAULT_DAILY_PREFS);
    expect(parseDailyPrefs({ ...DEFAULT_DAILY_PREFS, torfl: 'yes' })).toEqual(DEFAULT_DAILY_PREFS);
  });
});

describe('buildTorflSegment', () => {
  let repos: ReturnType<typeof createRepositories>;
  const drill = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-drill-fx')) as Exam;

  async function seedDeck(n: number, due: boolean) {
    for (const [i, entryItem] of drill.subtests[0]!.parts[0]!.items.slice(0, n).entries()) {
      await repos.exams.ensureCard({
        packId: PACK.id,
        examId: drill.id,
        itemId: entryItem.id,
        subtestKind: 'lexgram',
        topic: entryItem.topic,
        now: T0 + i,
      });
      if (!due) {
        await repos.exams.gradeCard(`${PACK.id}:${drill.id}:${entryItem.id}`, 3, T0 + 1000 + i);
      }
    }
  }

  beforeEach(async () => {
    const db = createTestDb();
    repos = createRepositories(db);
    await importPack(db, examPackJson);
    await importPack(db, a2PackJson);
  });

  it('serves due deck items, most overdue first, as torfl-mode entries', async () => {
    await seedDeck(4, true);
    const seg = await buildTorflSegment(repos, { now: T0 + 10_000 });
    expect(seg.map((s) => s.entry.item.id)).toEqual(['dr01', 'dr02', 'dr03', 'dr04']);
    expect(seg.every((s) => s.mode === 'torfl')).toBe(true);
  });
  it('is capped at 10 (the daily deck max)', async () => {
    expect(DAILY_DECK_MAX).toBe(10);
    await seedDeck(6, true);
    expect((await buildTorflSegment(repos, { now: T0 + 10_000, max: 2 })).length).toBe(2);
  });
  it('skips items not due, suspended cards and items a pack update removed', async () => {
    await seedDeck(3, false); // graded Good → due in days, not now
    expect(await buildTorflSegment(repos, { now: T0 + 5000 })).toHaveLength(0);
    await repos.exams.ensureCard({
      packId: PACK.id,
      examId: drill.id,
      itemId: 'dr05',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      now: T0,
    });
    await repos.exams.ensureCard({
      packId: PACK.id,
      examId: drill.id,
      itemId: 'removed-item',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      now: T0,
    });
    expect(
      (await buildTorflSegment(repos, { now: T0 + 5000 })).map((s) => s.entry.item.id),
    ).toEqual(['dr05']);
    await repos.exams.suspendCard(`${PACK.id}:${drill.id}:dr05`);
    expect(await buildTorflSegment(repos, { now: T0 + 5000 })).toHaveLength(0);
  });
  it('buildDailySession never adds exam items by itself (the screen composes the block)', async () => {
    await seedDeck(3, true);
    expect(await buildDailySession(repos, { now: T0 + 10_000 })).toEqual([]);
  });

  describe('T75: across levels', () => {
    const a2Drill = ExamSchema.parse(
      A2_PACK.exams!.find((e) => e.id === 'a2-drill-fx-time'),
    ) as Exam;
    const a2Items = a2Drill.subtests[0]!.parts[0]!.items;

    async function seedLevel(
      pack: Pack,
      exam: Exam,
      items: typeof a2Items,
      n: number,
      offset: number,
    ) {
      for (const [i, item] of items.slice(0, n).entries()) {
        await repos.exams.ensureCard({
          packId: pack.id,
          examId: exam.id,
          itemId: item.id,
          subtestKind: 'lexgram',
          topic: item.topic,
          now: T0 + offset + i,
        });
      }
    }

    it('T75: with no dates the segment orders A1 before A2', async () => {
      await seedLevel(PACK, drill, drill.subtests[0]!.parts[0]!.items, 2, 0);
      await seedLevel(A2_PACK, a2Drill, a2Items, 2, 100);
      const seg = await buildTorflSegment(repos, {
        now: T0 + 10_000,
        levels: levelOrder({ A1: null, A2: null }),
      });
      expect(seg.map((s) => s.entry.level)).toEqual(['A1', 'A1', 'A2', 'A2']);
    });
    it("T75: the nearest exam date's level goes first", async () => {
      await seedLevel(PACK, drill, drill.subtests[0]!.parts[0]!.items, 2, 0);
      await seedLevel(A2_PACK, a2Drill, a2Items, 2, 100);
      const seg = await buildTorflSegment(repos, {
        now: T0 + 10_000,
        levels: levelOrder({ A1: '2027-03-01', A2: '2026-12-01' }),
      });
      expect(seg.map((s) => s.entry.level)).toEqual(['A2', 'A2', 'A1', 'A1']);
    });
    it('T75: the cap spans levels (8 A1 + 5 A2 due, max 10 → 8 A1 + 2 A2)', async () => {
      await seedLevel(PACK, drill, drill.subtests[0]!.parts[0]!.items, 6, 0);
      await seedLevel(A2_PACK, a2Drill, a2Items, 5, 100);
      // The A1 fixture drill has 6 lexgram items; top up with the A1 mock's lexgram items.
      const mock = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx')) as Exam;
      const extra = mock.subtests
        .find((st) => st.kind === 'lexgram')!
        .parts.flatMap((p) => p.items);
      await seedLevel(PACK, mock, extra, 2, 200);
      const seg = await buildTorflSegment(repos, {
        now: T0 + 10_000,
        max: 10,
        levels: levelOrder({ A1: null, A2: null }),
      });
      expect(seg.map((s) => s.entry.level)).toEqual([
        'A1',
        'A1',
        'A1',
        'A1',
        'A1',
        'A1',
        'A1',
        'A1',
        'A2',
        'A2',
      ]);
    });
    it('T75: a level filter isolates', async () => {
      await seedLevel(PACK, drill, drill.subtests[0]!.parts[0]!.items, 2, 0);
      await seedLevel(A2_PACK, a2Drill, a2Items, 2, 100);
      const seg = await buildTorflSegment(repos, { now: T0 + 10_000, levels: ['A2'] });
      expect(seg.length).toBe(2);
      expect(seg.every((s) => s.entry.level === 'A2')).toBe(true);
    });
  });
});
