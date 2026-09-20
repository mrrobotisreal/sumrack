import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import journal from '../../../drizzle/meta/_journal.json';
import * as schema from '../schema';
import type { SumrakDB } from '../types';
import { createTestDb } from './helpers';

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../drizzle',
);

/**
 * A DB migrated only up to `lastTag` (inclusive) — the "device that ran the
 * previous release" fixture for upgrade tests. Applies the exact .sql files
 * in journal order the way the real migrator does (statement-breakpoint
 * split), then the returned handle can be passed to `migrate()` again to
 * apply the remaining entries.
 */
function createDbUpTo(lastTag: string): { sqlite: Database.Database; db: SumrakDB } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const entries = journal.entries;
  const stop = entries.findIndex((e) => e.tag === lastTag);
  if (stop < 0) throw new Error(`unknown migration tag ${lastTag}`);
  // Mirror drizzle's bookkeeping so a later migrate() resumes after `stop`.
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)',
  );
  for (const entry of entries.slice(0, stop + 1)) {
    const body = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    for (const stmt of body.split('--> statement-breakpoint')) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
    sqlite
      .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run(`test-${entry.tag}`, entry.when);
  }
  const db = drizzle(sqlite, { schema });
  return { sqlite, db: db as unknown as SumrakDB };
}

async function columnNames(db: SumrakDB, table: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
  return rows.map((r) => r.name);
}

async function indexNames(db: SumrakDB, table: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(sql.raw(`PRAGMA index_list(${table})`));
  return rows.map((r) => r.name);
}

const M14_PACK_COLUMNS = ['category', 'genre'];
const M14_STORY_COLUMNS = [
  'subtitle_ru',
  'subtitle_en',
  'source_name',
  'source_url',
  'source_published_at',
  'source_author',
];

describe('migrations from empty DB', () => {
  it('applies all migrations cleanly and creates every table', async () => {
    const db = createTestDb(); // throws if any migration fails from empty

    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`,
    );
    const names = rows.map((r) => r.name);

    const contentTables = [
      'packs',
      'stories',
      'sentences',
      'tokens',
      'audio_tracks',
      'word_stamps',
      'lessons',
      'journal_prompts',
      'exercise_specs',
    ];
    const userTables = [
      'bank_items',
      'encounters',
      'cards',
      'review_log',
      'journal_entries',
      'notes',
      'checkpoint_results',
      'assessments',
      'game_sessions',
      'daily_activity',
      'achievements',
      'import_requests',
      'imported_packs',
      'settings',
      'sync_state',
      'analytics_events',
    ];
    const ftsTables = ['tokens_fts', 'notes_fts', 'journal_fts'];

    for (const t of [...contentTables, ...userTables, ...ftsTables]) {
      expect(names, `table ${t} should exist`).toContain(t);
    }
  });

  it('creates the FTS sync triggers', async () => {
    const db = createTestDb();
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`,
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'tokens_fts_ai',
      'tokens_fts_ad',
      'tokens_fts_au',
      'notes_fts_ai',
      'notes_fts_ad',
      'notes_fts_au',
      'journal_fts_ai',
      'journal_fts_ad',
      'journal_fts_au',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('0011_library-categories: fresh DB has the M14 columns and index', async () => {
    const db = createTestDb();
    const packCols = await columnNames(db, 'packs');
    const storyCols = await columnNames(db, 'stories');
    for (const c of M14_PACK_COLUMNS) expect(packCols).toContain(c);
    for (const c of M14_STORY_COLUMNS) expect(storyCols).toContain(c);
    expect(await indexNames(db, 'stories')).toContain('stories_source_date_idx');
  });
});

describe('0011_library-categories upgrade from 0010', () => {
  it('adds the eight columns + index; pre-existing rows read NULL', async () => {
    const { sqlite, db } = createDbUpTo('0010_path-theme-track');
    // The previous release's tables really lack the columns.
    expect(await columnNames(db, 'packs')).not.toContain('category');
    expect(await columnNames(db, 'stories')).not.toContain('source_published_at');

    // A pack + story written by the previous release.
    sqlite
      .prepare(
        `INSERT INTO packs (id, version, type, title_ru, title_en, level, tags, imported_at, origin)
         VALUES ('a1-old-001', 1, 'stories', 'Старый', 'Old', 'A1', '[]', 0, 'remote')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO stories (pack_id, id, order_idx, title_ru, title_en, level)
         VALUES ('a1-old-001', 'old-s1', 0, 'Часть 1', 'Part 1', 'A1')`,
      )
      .run();

    migrate(drizzle(sqlite, { schema }), { migrationsFolder });

    const packCols = await columnNames(db, 'packs');
    const storyCols = await columnNames(db, 'stories');
    for (const c of M14_PACK_COLUMNS) expect(packCols).toContain(c);
    for (const c of M14_STORY_COLUMNS) expect(storyCols).toContain(c);
    expect(await indexNames(db, 'stories')).toContain('stories_source_date_idx');

    const pack = await db.all<Record<string, unknown>>(
      sql`SELECT category, genre FROM packs WHERE id = 'a1-old-001'`,
    );
    expect(pack[0]).toEqual({ category: null, genre: null });
    const story = await db.all<Record<string, unknown>>(
      sql`SELECT subtitle_ru, subtitle_en, source_name, source_url, source_published_at, source_author
          FROM stories WHERE pack_id = 'a1-old-001'`,
    );
    expect(story[0]).toEqual({
      subtitle_ru: null,
      subtitle_en: null,
      source_name: null,
      source_url: null,
      source_published_at: null,
      source_author: null,
    });
    // The upgrade applied exactly the pending entries — nothing re-ran.
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
  });
});
