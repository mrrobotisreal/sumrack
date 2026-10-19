import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import journal from '../../../../drizzle/meta/_journal.json';
import * as schema from '@/db/schema';
import type { SumrakDB } from '@/db/types';

import { SYNCED_TABLES } from '../registry';
import { generateTriggerSql, spliceTriggerBlock } from '../trigger-sql';

const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../drizzle');
const MIGRATION = path.join(drizzleDir, '0023_sync.sql');

function createDbUpTo(lastTag: string) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const stop = journal.entries.findIndex((e) => e.tag === lastTag);
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)',
  );
  for (const entry of journal.entries.slice(0, stop + 1)) {
    const body = fs.readFileSync(path.join(drizzleDir, `${entry.tag}.sql`), 'utf8');
    for (const stmt of body.split('--> statement-breakpoint')) if (stmt.trim()) sqlite.exec(stmt);
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run(`test-${entry.tag}`, entry.when);
  }
  return { sqlite, db: drizzle(sqlite, { schema }) as unknown as SumrakDB };
}

async function outbox(db: SumrakDB) {
  return db.all<{ tbl: string; pk: string; op: string; hlc: number }>(
    sql`SELECT tbl, pk, op, hlc FROM sync_outbox ORDER BY id`,
  );
}

describe('0023_sync migration', () => {
  it('the committed trigger block equals a regeneration from the registry', () => {
    const text = fs.readFileSync(MIGRATION, 'utf8');
    expect(spliceTriggerBlock(text)).toBe(text);
    expect(text).toContain(generateTriggerSql());
  });

  it('fresh DB: infra tables, one control row, one clock row, 3 triggers per synced table', async () => {
    const db = createTestDb();
    const t = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = t.map((r) => r.name);
    for (const n of [
      'sync_outbox', 'sync_control', 'sync_clock', 'sync_id_map', 'sync_parked',
      'sync_row_hlc', 'daily_activity_own', 'daily_activity_peers',
    ]) expect(names).toContain(n);
    expect(await db.all(sql`SELECT * FROM sync_control`)).toEqual([{ id: 1, applying: 0 }]);
    expect(await db.all(sql`SELECT * FROM sync_clock`)).toEqual([{ id: 1, last: 0 }]);
    const trg = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync\\_%' ESCAPE '\\'`,
    );
    const expected = SYNCED_TABLES.reduce((n, s) => n + (s.insertOnly ? 1 : 3), 0);
    expect(trg).toHaveLength(expected);
  });

  it('upgrade from 0022 backfills daily_activity_own and adds analytics sync_key', async () => {
    const { sqlite, db } = createDbUpTo('0022_stats-aggregates');
    sqlite.exec(
      `INSERT INTO daily_activity (date, reviews_done, reading_ms, stories_finished, goal_met_at, xp, updated_at)
       VALUES ('2026-10-01', 12, 3000, 1, 99, 40, 5), ('2026-10-02', 3, 0, 0, NULL, 6, 7)`,
    );
    sqlite.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('goal.daily', '{}', 1)`);
    migrate(db as never, { migrationsFolder: drizzleDir });
    expect(
      await db.all(sql`SELECT * FROM daily_activity_own ORDER BY date`),
    ).toEqual(await db.all(sql`SELECT * FROM daily_activity ORDER BY date`));
    // Backfill ran before the triggers existed -> nothing queued from it.
    expect(await outbox(db)).toEqual([]);
    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(analytics_events)`);
    expect(cols.map((c) => c.name)).toContain('sync_key');
  });

  it('insert / update / delete enqueue upserts and a delete with the pk as a JSON array', async () => {
    const db = createTestDb();
    await db.run(sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n1','t','b',1,1)`);
    await db.run(sql`UPDATE notes SET title = 'x' WHERE id = 'n1'`);
    await db.run(sql`DELETE FROM notes WHERE id = 'n1'`);
    const o = await outbox(db);
    expect(o.map((r) => [r.tbl, r.pk, r.op])).toEqual([
      ['notes', '["n1"]', 'upsert'],
      ['notes', '["n1"]', 'upsert'],
      ['notes', '["n1"]', 'delete'],
    ]);
    expect(o[1]!.hlc).toBeGreaterThan(o[0]!.hlc); // strictly increasing clock
    expect(o[2]!.hlc).toBeGreaterThan(o[1]!.hlc);
  });

  it('composite pks encode in schema order', async () => {
    const db = createTestDb();
    await db.run(sql`INSERT INTO story_progress (pack_id, story_id, current_sentence_idx, started_at, updated_at) VALUES ('p','s',1,1,1)`);
    expect((await outbox(db))[0]!.pk).toBe('["p","s"]');
  });

  it('is silent while sync_control.applying = 1', async () => {
    const db = createTestDb();
    await db.run(sql`UPDATE sync_control SET applying = 1`);
    await db.run(sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n1','t','b',1,1)`);
    await db.run(sql`DELETE FROM notes WHERE id = 'n1'`);
    expect(await outbox(db)).toEqual([]);
    await db.run(sql`UPDATE sync_control SET applying = 0`);
    await db.run(sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ('n2','t','b',1,1)`);
    expect(await outbox(db)).toHaveLength(1);
  });

  it('settings: device-local keys never enqueue, synced keys do', async () => {
    const db = createTestDb();
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('sync.cursor','5',1)`);
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('themeMode','"dark"',1)`);
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('auth.future','1',1)`);
    expect(await outbox(db)).toEqual([]);
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('goal.daily','{}',1)`);
    expect((await outbox(db)).map((r) => r.pk)).toEqual(['["goal.daily"]']);
  });

  it('cascade deletes enqueue the child deletes', async () => {
    const db = createTestDb();
    await db.run(sql`INSERT INTO bank_items (id, kind, lemma, lemma_norm, surface, normalized, translation, created_at) VALUES ('b1','word','x','x','x','x','y',1)`);
    await db.run(sql`INSERT INTO cards (id, bank_item_id, direction, due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, created_at) VALUES ('c1','b1','ru-en',1,0,0,0,0,0,0,0,0,1)`);
    await db.run(sql`INSERT INTO review_log (id, card_id, rating, state, due_at, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, reviewed_at) VALUES ('r1','c1',3,0,1,0,0,0,0,0,0,1)`);
    await db.run(sql`DELETE FROM sync_outbox`);
    await db.run(sql`DELETE FROM bank_items WHERE id = 'b1'`);
    const dels = (await outbox(db)).filter((r) => r.op === 'delete').map((r) => `${r.tbl}${r.pk}`);
    expect(dels.sort()).toEqual(['bank_items["b1"]', 'cards["c1"]', 'review_log["r1"]']);
  });

  it('daily_activity (the merged table) and device-local tables never enqueue', async () => {
    const db = createTestDb();
    await db.run(sql`INSERT INTO daily_activity (date, updated_at) VALUES ('2026-10-01', 1)`);
    await db.run(sql`INSERT INTO daily_activity_peers (date, device_id, updated_at) VALUES ('2026-10-01','d2',1)`);
    await db.run(sql`INSERT INTO sync_state (pack_id, version, source, installed_at, updated_at) VALUES ('p',1,'x',1,1)`);
    expect(await outbox(db)).toEqual([]);
    await db.run(sql`INSERT INTO daily_activity_own (date, updated_at) VALUES ('2026-10-01', 1)`);
    expect((await outbox(db)).map((r) => r.tbl)).toEqual(['daily_activity_own']);
  });
});
