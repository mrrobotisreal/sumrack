import { sql } from 'drizzle-orm';

import type { SumrakDB } from '@/db/types';

import { readSetting, writeSetting } from './engine';
import { isDeviceLocalSetting, SYNCED_TABLES } from './registry';
import type { WireMe } from './wire';

/**
 * First link (T105, ACCOUNTS_AND_SYNC §5.4). The outbox triggers only see
 * writes made AFTER migration 0023, so a phone with months of history would
 * push almost nothing on its first run. Linking therefore SEEDS: one outbox
 * row per existing row of every synced table, stamped with a fresh HLC so
 * the pushed rows are newer than nothing on the server and older than any
 * edit made afterwards. Then a normal run pushes them and pulls whatever the
 * account already holds — the engine's class merges (append-only union,
 * natural-key collapse, monotonic max/min, FSRS replay, per-device daily
 * totals) make that the «Объединить» merge. One SQL statement per table.
 */

export type LinkMode = 'seed' | 'merge';

/** Server has records → merge (push all, pull all, class merges); else seed. */
export function linkModeFor(me: Pick<WireMe, 'recordCount'>): LinkMode {
  return me.recordCount > 0 ? 'merge' : 'seed';
}

const pkJson = (pk: string[]) => `json_array(${pk.map((c) => `"${c}"`).join(', ')})`;

/** Enqueue every existing synced row. Returns the number of rows enqueued. */
export async function seedOutbox(
  db: SumrakDB,
  now = Date.now(),
  mode: LinkMode = 'seed',
): Promise<number> {
  let total = 0;
  await db.run(sql`BEGIN`);
  try {
    // 'seed' (first phone, empty account): a normal fresh clock.
    // 'merge' (the account already has data): the LOWEST clock (1) — this
    // phone's copies are history, not edits, and must never beat the
    // account's (2026-10-20: the S25's seed overwrote the S24U's ai.model,
    // 3 daily quests and a finished story). A row the account lacks still
    // arrives; monotonic/append-only rows merge by value regardless; real
    // edits after the link get normal clocks and win as usual.
    await db.run(sql`UPDATE sync_clock SET last = MAX(last + 1, ${now})`);
    const seedHlc = mode === 'merge' ? 1 : null;
    for (const spec of SYNCED_TABLES) {
      const where =
        spec.cls === 'settings'
          ? sql.raw(`WHERE key NOT LIKE 'sync.%' AND key NOT LIKE 'auth.%'`)
          : sql.raw('');
      const rows = await db.all<{ pk: string; key?: string }>(
        sql`SELECT ${sql.raw(pkJson(spec.pk))} AS pk${sql.raw(spec.cls === 'settings' ? ', key' : '')}
            FROM ${sql.raw(`"${spec.name}"`)} ${where}`,
      );
      for (const r of rows) {
        if (spec.cls === 'settings' && r.key != null && isDeviceLocalSetting(r.key)) continue;
        await db.run(sql`INSERT INTO sync_outbox (tbl, pk, op, hlc, created_at)
          VALUES (${spec.name}, ${r.pk}, 'upsert', ${seedHlc ?? sql`(SELECT last FROM sync_clock)`}, ${now})`);
        total++;
      }
    }
    await db.run(sql`COMMIT`);
  } catch (e) {
    await db.run(sql`ROLLBACK`);
    throw e;
  }
  return total;
}

/**
 * Link this phone to the signed-in account: seed the outbox once, mark the
 * phone linked, and record which uid it was linked to. Idempotent per uid —
 * re-linking the same account (app relaunch) never re-seeds; a different
 * account seeds again.
 */
export async function linkDevice(
  db: SumrakDB,
  uid: string,
  now = Date.now(),
  mode: LinkMode = 'seed',
): Promise<{ seeded: number; already: boolean }> {
  const linkedUid = await readSetting<string>(db, 'sync.linkedUid');
  if (linkedUid === uid && (await readSetting<boolean>(db, 'sync.linked')) === true) {
    return { seeded: 0, already: true };
  }
  const seeded = await seedOutbox(db, now, mode);
  await writeSetting(db, 'sync.linkedUid', uid);
  await writeSetting(db, 'sync.linked', true);
  return { seeded, already: false };
}

/**
 * The signed-in account is not the one this phone was linked to (Mitch,
 * 2026-10-20: linked under the test account by mistake, signed out mid-run,
 * signed in with the real one — ~1,000 rows had already been acked to the
 * test account and were never sent to the real one). Everything that is
 * per-ACCOUNT is reset — pull cursor, server clocks, id map, parked
 * changes, peer daily totals (merged totals fall back to this phone's own)
 * — and every row is seeded again for the new account. Local user data is
 * never touched.
 */
export async function relinkForAccount(
  db: SumrakDB,
  uid: string,
  now = Date.now(),
  mode: LinkMode = 'merge',
): Promise<number> {
  await db.run(sql`BEGIN`);
  try {
    await db.run(sql`UPDATE sync_control SET applying = 1`);
    await db.run(sql`DELETE FROM sync_outbox`);
    await db.run(sql`DELETE FROM sync_row_hlc`);
    await db.run(sql`DELETE FROM sync_id_map`);
    await db.run(sql`DELETE FROM sync_parked`);
    await db.run(sql`DELETE FROM sync_dirty_cards`);
    // Peer totals belonged to the old account: merged = own again on those dates.
    await db.run(sql`DELETE FROM daily_activity
      WHERE date IN (SELECT date FROM daily_activity_peers)
        AND date NOT IN (SELECT date FROM daily_activity_own)`);
    await db.run(sql`UPDATE daily_activity SET
        reviews_done = (SELECT o.reviews_done FROM daily_activity_own o WHERE o.date = daily_activity.date),
        reading_ms = (SELECT o.reading_ms FROM daily_activity_own o WHERE o.date = daily_activity.date),
        stories_finished = (SELECT o.stories_finished FROM daily_activity_own o WHERE o.date = daily_activity.date),
        goal_met_at = (SELECT o.goal_met_at FROM daily_activity_own o WHERE o.date = daily_activity.date),
        xp = (SELECT o.xp FROM daily_activity_own o WHERE o.date = daily_activity.date)
      WHERE date IN (SELECT date FROM daily_activity_peers)`);
    await db.run(sql`DELETE FROM daily_activity_peers`);
    await db.run(sql`DELETE FROM settings WHERE key IN ('sync.cursor', 'sync.registeredUid')`);
    await db.run(sql`UPDATE sync_control SET applying = 0`);
    await db.run(sql`COMMIT`);
  } catch (e) {
    await db.run(sql`ROLLBACK`);
    throw e;
  }
  const seeded = await seedOutbox(db, now, mode);
  await writeSetting(db, 'sync.linkedUid', uid);
  await writeSetting(db, 'sync.linked', true);
  return seeded;
}
