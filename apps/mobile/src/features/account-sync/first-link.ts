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
export async function seedOutbox(db: SumrakDB, now = Date.now()): Promise<number> {
  let total = 0;
  await db.run(sql`BEGIN`);
  try {
    // One HLC above everything seen so far; every seeded row shares it.
    await db.run(sql`UPDATE sync_clock SET last = MAX(last + 1, ${now})`);
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
          VALUES (${spec.name}, ${r.pk}, 'upsert', (SELECT last FROM sync_clock), ${now})`);
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
): Promise<{ seeded: number; already: boolean }> {
  const linkedUid = await readSetting<string>(db, 'sync.linkedUid');
  if (linkedUid === uid && (await readSetting<boolean>(db, 'sync.linked')) === true) {
    return { seeded: 0, already: true };
  }
  const seeded = await seedOutbox(db, now);
  await writeSetting(db, 'sync.linkedUid', uid);
  await writeSetting(db, 'sync.linked', true);
  return { seeded, already: false };
}
