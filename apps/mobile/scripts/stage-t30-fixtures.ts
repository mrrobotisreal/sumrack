/**
 * T30 on-device fixture staging (the T10/T17 host-side pattern): open a
 * PULLED device sumrak.db with better-sqlite3, bring it to the latest
 * migrations, and run the app's OWN importer over the T30 path fixtures —
 * content tables only, user data untouched. Sync never removes packs that
 * are missing from the manifest, so staged fixtures survive a real sync;
 * remove them any time from the packs management screen.
 *
 * Usage (from apps/mobile, app force-stopped first):
 *   adb shell am force-stop io.winapps.sumrak
 *   adb exec-out run-as io.winapps.sumrak cat files/SQLite/sumrak.db > /tmp/sumrak.db
 *   npx tsx scripts/stage-t30-fixtures.ts /tmp/sumrak.db
 *   cat /tmp/sumrak.db | adb shell run-as io.winapps.sumrak sh -c 'cat > files/SQLite/sumrak.db'
 *
 * (If files/SQLite also holds sumrak.db-wal / -shm, delete them on-device
 * after pushing — the pulled snapshot is the checkpointed truth.)
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';

import hallway from '@sumrak/schema/fixtures/packs/a1-course-unit-090/pack.json';
import kitchen from '@sumrak/schema/fixtures/packs/a1-course-unit-091/pack.json';
import cellar from '@sumrak/schema/fixtures/packs/a1-course-unit-092/pack.json';
import greenhouse from '@sumrak/schema/fixtures/packs/a1-course-unit-093/pack.json';
import family from '@sumrak/schema/fixtures/packs/a2-family-090/pack.json';

import { importPack } from '../src/db/importer';
import * as schema from '../src/db/schema';
import type { SumrakDB } from '../src/db/types';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: npx tsx scripts/stage-t30-fixtures.ts <path-to-pulled-sumrak.db>');
  process.exit(1);
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = DELETE'); // device snapshot: no stray -wal on push
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema }) as unknown as SumrakDB;

// Same .sql files the device runs; no-op for already-applied entries.
migrate(db as never, { migrationsFolder: join(__dirname, '..', 'drizzle') });

async function main() {
  for (const pack of [hallway, kitchen, cellar, greenhouse, family]) {
    const result = await importPack(db, pack, { source: 'bundled' });
    console.log(`${result.packId}@v${result.version}: ${result.action}`);
  }

  const rows = sqlite
    .prepare(
      `SELECT id, theme_scene, theme_accent, track FROM packs WHERE type = 'course-unit' ORDER BY id`,
    )
    .all();
  console.table(rows);
  sqlite.close();
  console.log('done — push the file back and restart the app');
}

void main();
