import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createStatsRepo } from '@/db/repositories/stats';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';

import { readSetting, writeSetting } from '../engine';

describe('restore (T20) resets the sync bookkeeping (T104)', () => {
  it('own daily = restored totals; peers/outbox/id-map/parked cleared; cursor 0; unlinked; deviceId kept', async () => {
    // Source phone with some history.
    const src = createTestDb();
    await createStatsRepo(src).bumpDailyActivity({ reviewsDone: 4, xp: 9 }, '2026-10-03');
    await src.run(
      sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n1','t','b',1,1)`,
    );
    const { payload } = await exportUserData(src);

    // Target phone mid-sync: peers, outbox, map, parked, cursor, linked, own deviceId.
    const db = createTestDb();
    await writeSetting(db, 'sync.deviceId', 'dev-target');
    await writeSetting(db, 'sync.cursor', 777);
    await writeSetting(db, 'sync.linked', true);
    await createStatsRepo(db).bumpDailyActivity({ reviewsDone: 100 }, '2026-10-09');
    await db.run(
      sql`INSERT INTO daily_activity_peers (date, device_id, reviews_done, updated_at) VALUES ('2026-10-03','dev-X',50,1)`,
    );
    await db.run(
      sql`INSERT INTO sync_id_map (tbl, remote_pk, local_pk) VALUES ('bank_items','["a"]','["b"]')`,
    );
    await db.run(
      sql`INSERT INTO sync_parked (tbl, pk, op, hlc, device_id, parked_at) VALUES ('cards','["c"]','upsert',1,'dev-X',1)`,
    );
    await db.run(
      sql`INSERT INTO sync_row_hlc (tbl, pk, hlc, device_id) VALUES ('notes','["n"]',1,'dev-X')`,
    );

    await restoreUserData(db, payload);

    const own = await db.all(sql`SELECT date, reviews_done, xp FROM daily_activity_own`);
    expect(own).toEqual([{ date: '2026-10-03', reviews_done: 4, xp: 9 }]);
    for (const t of [
      'daily_activity_peers',
      'sync_outbox',
      'sync_id_map',
      'sync_parked',
      'sync_row_hlc',
    ]) {
      expect(await db.all(sql.raw(`SELECT * FROM ${t}`)), t).toEqual([]);
    }
    expect((await readSetting<number>(db, 'sync.cursor')) ?? 0).toBe(0); // absent == 0
    expect((await readSetting<boolean>(db, 'sync.linked')) === true).toBe(false); // absent == unlinked
    expect(await readSetting(db, 'sync.deviceId')).toBe('dev-target');
    // The restore's own writes were not queued as user edits, but later edits are.
    await db.run(
      sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n2','t','b',1,1)`,
    );
    expect(await db.all(sql`SELECT tbl FROM sync_outbox`)).toEqual([{ tbl: 'notes' }]);
  });
});
