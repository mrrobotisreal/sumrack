import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { importPack } from '@/db/importer';
import { createRepositories } from '@/db/repositories';
import { DAILY_DECK_MAX } from '@/features/torfl/drill/drill-model';

import { DEFAULT_DAILY_PREFS, parseDailyPrefs, torflSegmentEnabled } from '../prefs';
import { buildDailySession, buildTorflSegment } from '../session';

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

/**
 * T70: the daily session's optional TORFL segment — on iff an exam date is
 * set (an explicit toggle overrides), ≤ 10 due deck items, resolved against
 * the current exams, never touching `cards`.
 */

const PACK = examPackJson as unknown as Pack;
const T0 = 1_790_000_000_000;

describe('torflSegmentEnabled / prefs', () => {
  it('auto = on iff an exam date is set; an explicit value wins', () => {
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, null)).toBe(false);
    expect(torflSegmentEnabled(DEFAULT_DAILY_PREFS, '2026-12-01')).toBe(true);
    expect(torflSegmentEnabled({ ...DEFAULT_DAILY_PREFS, torfl: false }, '2026-12-01')).toBe(false);
    expect(torflSegmentEnabled({ ...DEFAULT_DAILY_PREFS, torfl: true }, null)).toBe(true);
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
});
