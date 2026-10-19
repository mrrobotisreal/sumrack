import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createStatsRepo } from '@/db/repositories/stats';

describe('stats writers maintain daily_activity_own (T104 D)', () => {
  it('bumpDailyActivity writes both the merged total and this phone\'s own row', async () => {
    const db = createTestDb();
    const stats = createStatsRepo(db);
    await stats.bumpDailyActivity({ reviewsDone: 2, xp: 5 }, '2026-10-01');
    await stats.bumpDailyActivity({ reviewsDone: 1, readingMs: 900 }, '2026-10-01');
    const own = await db.all(sql`SELECT date, reviews_done, reading_ms, xp FROM daily_activity_own`);
    expect(own).toEqual([{ date: '2026-10-01', reviews_done: 3, reading_ms: 900, xp: 5 }]);
    expect((await stats.getDailyActivity('2026-10-01'))?.reviewsDone).toBe(3);
  });

  it('markGoalMet mirrors the stamp onto own and stays one-way', async () => {
    const db = createTestDb();
    const stats = createStatsRepo(db);
    await stats.bumpDailyActivity({ reviewsDone: 20 }, '2026-10-01');
    expect(await stats.markGoalMet('2026-10-01')).toBe(true);
    const own = await db.all<{ goal_met_at: number | null }>(sql`SELECT goal_met_at FROM daily_activity_own`);
    expect(own[0]!.goal_met_at).toBeTypeOf('number');
    expect(await stats.markGoalMet('2026-10-01')).toBe(false);
  });

  it('own-row writes reach the outbox (one pk per date)', async () => {
    const db = createTestDb();
    await createStatsRepo(db).bumpDailyActivity({ xp: 1 }, '2026-10-02');
    const o = await db.all<{ tbl: string; pk: string }>(sql`SELECT tbl, pk FROM sync_outbox`);
    expect(o).toEqual([{ tbl: 'daily_activity_own', pk: '["2026-10-02"]' }]);
  });
});
