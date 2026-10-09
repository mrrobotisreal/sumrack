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
      'scenarios',
      'scenario_turns',
      'scenario_glossary',
      'scenario_line_audio',
      'scenario_line_stamps',
      'scenario_assets',
      'exams',
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
      'word_profiles',
      'grammar_lessons',
      'scenario_runs',
      'scenario_attempts',
      'exam_attempts',
      'exam_responses',
      'exam_item_cards',
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

  it('0012_review-source: fresh DB has review_log.source + its index', async () => {
    const db = createTestDb();
    expect(await columnNames(db, 'review_log')).toContain('source');
    expect(await indexNames(db, 'review_log')).toContain('review_log_source_idx');
  });

  it('0013_word-profiles: fresh DB has both M16 tables, all indexes, and the partial unique index', async () => {
    const db = createTestDb();
    await expectWordProfileTables(db);
  });

  it('0014_scenarios: fresh DB has the five content + two user tables with their indexes', async () => {
    const db = createTestDb();
    await expectScenarioTables(db);
  });

  it('0015_exams: fresh DB has the exams content table + three user tables with their indexes', async () => {
    const db = createTestDb();
    await expectExamTables(db);
    expect(journal.entries.find((e: { idx: number }) => e.idx === 15)).toMatchObject({
      tag: '0015_exams',
    });
  });

  it('0016_core-lemmas: fresh DB has core_lemmas (content) + leech_dismissals (user)', async () => {
    const db = createTestDb();
    expect(await columnNames(db, 'core_lemmas')).toEqual(
      expect.arrayContaining(['pack_id', 'list_id', 'level', 'entry_idx', 'lemma', 'lemma_norm']),
    );
    expect(await indexNames(db, 'core_lemmas')).toEqual(
      expect.arrayContaining(['core_lemmas_norm_idx', 'core_lemmas_level_idx']),
    );
    expect(await columnNames(db, 'leech_dismissals')).toEqual(['card_id', 'dismissed_at']);
    expect(journal.entries.find((e) => e.tag === '0016_core-lemmas')).toMatchObject({ idx: 16 });
  });

  it('0017_card-management: fresh DB cards has suspended_at + buried_until (nullable, additive)', async () => {
    const db = createTestDb();
    const cols = await columnNames(db, 'cards');
    expect(cols).toEqual(expect.arrayContaining(['suspended_at', 'buried_until']));
    const rows = await db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(cards)`);
    for (const name of ['suspended_at', 'buried_until']) {
      expect(rows.find((r) => r.name === name)?.notnull).toBe(0);
    }
    expect(journal.entries.find((e) => e.tag === '0017_card-management')).toMatchObject({
      idx: 17,
    });
  });

  it('0018_daily-quests: fresh DB has daily_quests (user, one row per local day)', async () => {
    const db = createTestDb();
    expect(await columnNames(db, 'daily_quests')).toEqual([
      'date',
      'kind',
      'target',
      'progress',
      'snapshot',
      'assigned_at',
      'completed_at',
      'xp',
    ]);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 18, tag: '0018_daily-quests' });
  });
});

/** T68 shape assertions shared by the fresh + upgrade cases (TORFL_EXAM_PREP §4.1/§4.2). */
async function expectExamTables(db: SumrakDB) {
  expect(await columnNames(db, 'exams')).toEqual([
    'pack_id',
    'exam_id',
    'order_idx',
    'format',
    'level',
    'mode',
    'title_ru',
    'title_en',
    'json',
  ]);
  expect(await columnNames(db, 'exam_attempts')).toEqual([
    'id',
    'pack_id',
    'exam_id',
    'scope',
    'subtest_ids',
    'mode',
    'status',
    'state_json',
    'started_at',
    'finished_at',
    'results_json',
    'verdict',
    'xp_awarded',
    'pinned',
  ]);
  expect(await columnNames(db, 'exam_responses')).toEqual([
    'id',
    'attempt_id',
    'subtest_id',
    'item_id',
    'answer_json',
    'points',
    'max_points',
    'grading_status',
    'grading_json',
    'duration_ms',
    'created_at',
    'updated_at',
  ]);
  expect(await columnNames(db, 'exam_item_cards')).toEqual([
    'item_key',
    'pack_id',
    'exam_id',
    'item_id',
    'subtest_kind',
    'topic',
    'fsrs_json',
    'due',
    'last_result',
    'suspended',
    'created_at',
    'updated_at',
  ]);
  expect(await indexNames(db, 'exams')).toEqual(expect.arrayContaining(['exams_mode_idx']));
  expect(await indexNames(db, 'exam_attempts')).toEqual(
    expect.arrayContaining(['exam_attempts_status_idx', 'exam_attempts_exam_idx']),
  );
  expect(await indexNames(db, 'exam_responses')).toEqual(
    expect.arrayContaining(['exam_responses_item_uq', 'exam_responses_grading_idx']),
  );
  expect(await indexNames(db, 'exam_item_cards')).toEqual(
    expect.arrayContaining(['exam_item_cards_due_idx', 'exam_item_cards_topic_idx']),
  );
  const idx = await db.all<{ name: string; unique: number }>(
    sql.raw('PRAGMA index_list(exam_responses)'),
  );
  expect(idx.find((i) => i.name === 'exam_responses_item_uq')).toMatchObject({ unique: 1 });
  // Content FK cascades from packs; responses cascade with their attempt; no other FKs.
  const fk = async (t: string) =>
    db.all<{ table: string; on_delete: string }>(sql.raw(`PRAGMA foreign_key_list(${t})`));
  expect(await fk('exams')).toEqual([
    expect.objectContaining({ table: 'packs', on_delete: 'CASCADE' }),
  ]);
  expect(await fk('exam_responses')).toEqual([
    expect.objectContaining({ table: 'exam_attempts', on_delete: 'CASCADE' }),
  ]);
  expect(await fk('exam_attempts')).toEqual([]);
  expect(await fk('exam_item_cards')).toEqual([]);
}

/** T58 shape assertions shared by the fresh + upgrade cases (SPEAKING_SCENARIOS §4.1/§4.2). */
async function expectScenarioTables(db: SumrakDB) {
  expect(await columnNames(db, 'scenarios')).toEqual([
    'pack_id',
    'id',
    'order_idx',
    'family_id',
    'title_ru',
    'title_en',
    'level',
    'language',
    'brief_ru',
    'brief_en',
    'cast_json',
    'scene_json',
    'start_turn_id',
    'endings_json',
    'nudges_json',
    'glossary_count',
  ]);
  expect(await columnNames(db, 'scenario_turns')).toEqual([
    'pack_id',
    'scenario_id',
    'id',
    'order_idx',
    'speaker_id',
    'say_json',
    'expect_json',
    'retry_json',
    'next_json',
    'ending_id',
  ]);
  expect(await columnNames(db, 'scenario_glossary')).toEqual([
    'pack_id',
    'scenario_id',
    'id',
    'ru',
    'ru_norm',
    'en',
    'forms_json',
    'translit_json',
    'explain_sentence_id',
    'how_to_say_sentence_id',
  ]);
  expect(await columnNames(db, 'scenario_line_audio')).toEqual([
    'pack_id',
    'sentence_id',
    'scenario_id',
    'variant',
    'file',
    'local_uri',
    'duration_ms',
    'mouth',
  ]);
  expect(await columnNames(db, 'scenario_line_stamps')).toEqual([
    'pack_id',
    'sentence_id',
    'stamp_index',
    'token_index',
    'start_ms',
    'end_ms',
  ]);
  expect(await columnNames(db, 'scenario_assets')).toEqual([
    'pack_id',
    'file',
    'local_uri',
    'bytes',
  ]);
  // §4.2 verbatim.
  expect(await columnNames(db, 'scenario_runs')).toEqual([
    'id',
    'pack_id',
    'scenario_id',
    'family_id',
    'level',
    'started_at',
    'finished_at',
    'ending_id',
    'path_json',
    'stats_json',
    'pinned',
    'media_local',
    'media_bundle_state',
    'media_bundle_name',
    'game_session_id',
  ]);
  expect(await columnNames(db, 'scenario_attempts')).toEqual([
    'id',
    'run_id',
    'turn_id',
    'attempt_no',
    'kind',
    'outcome',
    'transcript',
    'detail_json',
    'audio_file',
    'audio_duration_ms',
    'created_at',
  ]);
  expect(await indexNames(db, 'scenario_glossary')).toContain('scenario_glossary_norm_idx');
  expect(await indexNames(db, 'scenario_turns')).toContain('scenario_turns_scenario_idx');
  expect(await indexNames(db, 'scenario_line_audio')).toContain('scenario_line_audio_scenario_idx');
  expect(await indexNames(db, 'scenario_runs')).toEqual(
    expect.arrayContaining(['scenario_runs_scenario_idx', 'scenario_runs_finished_idx']),
  );
  expect(await indexNames(db, 'scenario_attempts')).toContain('scenario_attempts_run_idx');
  // Cascades: content tables hang off packs; attempts hang off their run.
  const fks = await db.all<{ table: string; on_delete: string }>(
    sql.raw('PRAGMA foreign_key_list(scenario_attempts)'),
  );
  expect(fks).toEqual([expect.objectContaining({ table: 'scenario_runs', on_delete: 'CASCADE' })]);
  for (const t of [
    'scenarios',
    'scenario_turns',
    'scenario_glossary',
    'scenario_line_audio',
    'scenario_line_stamps',
    'scenario_assets',
  ]) {
    const rows = await db.all<{ table: string; on_delete: string }>(
      sql.raw(`PRAGMA foreign_key_list(${t})`),
    );
    expect(rows, t).toEqual([expect.objectContaining({ table: 'packs', on_delete: 'CASCADE' })]);
  }
}

describe('0015_exams upgrade from 0014', () => {
  it('creates the four tables on a device that ran 0014; pre-existing rows untouched; responses cascade with their attempt', async () => {
    const { sqlite, db } = createDbUpTo('0014_scenarios');
    sqlite
      .prepare(
        `INSERT INTO bank_items (id, kind, lemma, lemma_norm, surface, normalized, translation, needs_enrichment, created_at)
         VALUES ('bi-1', 'word', 'тёмный', 'темный', 'тёмный', 'темный', 'dark', 0, 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO scenario_runs (id, pack_id, scenario_id, family_id, level, started_at, path_json)
         VALUES ('run-1', 'p', 'radio-a1', 'radio', 'A1', 1, '{"v":1,"steps":[]}')`,
      )
      .run();
    const before = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'exam%'`,
    );
    expect(before).toEqual([]);

    migrate(drizzle(sqlite, { schema }), { migrationsFolder });

    await expectExamTables(db);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM bank_items').get()).toEqual({ n: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM scenario_runs').get()).toEqual({ n: 1 });
    sqlite
      .prepare(
        `INSERT INTO exam_attempts (id, pack_id, exam_id, scope, subtest_ids, mode, status, state_json, started_at)
         VALUES ('att-1', 'p', 'a1-mock-fx', 'full', '["lexgram"]', 'mock', 'active', '{}', 1)`,
      )
      .run();
    // §4.2 defaults: xp_awarded 0, pinned false.
    expect(
      sqlite.prepare('SELECT xp_awarded, pinned FROM exam_attempts WHERE id = ?').get('att-1'),
    ).toEqual({ xp_awarded: 0, pinned: 0 });
    const insertResponse = sqlite.prepare(
      `INSERT INTO exam_responses (id, attempt_id, subtest_id, item_id, answer_json, max_points, grading_status, created_at, updated_at)
       VALUES (?, 'att-1', 'lexgram', 'lg01', '{}', 1, 'scored', 2, 2)`,
    );
    insertResponse.run('r-1');
    // UNIQUE(attemptId, subtestId, itemId).
    expect(() => insertResponse.run('r-2')).toThrow(/UNIQUE/);
    sqlite.prepare("DELETE FROM exam_attempts WHERE id = 'att-1'").run();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM exam_responses').get()).toEqual({ n: 0 });
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
  });
});

describe('0014_scenarios upgrade from 0013', () => {
  it('creates the seven tables on a device that ran 0013; pre-existing rows untouched; attempts cascade with their run', async () => {
    const { sqlite, db } = createDbUpTo('0013_word-profiles');
    sqlite
      .prepare(
        `INSERT INTO bank_items (id, kind, lemma, lemma_norm, surface, normalized, translation, needs_enrichment, created_at)
         VALUES ('bi-1', 'word', 'тёмный', 'темный', 'тёмный', 'темный', 'dark', 0, 1)`,
      )
      .run();
    const before = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'scenario%'`,
    );
    expect(before).toEqual([]);

    migrate(drizzle(sqlite, { schema }), { migrationsFolder });

    await expectScenarioTables(db);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM bank_items').get()).toEqual({ n: 1 });
    sqlite
      .prepare(
        `INSERT INTO scenario_runs (id, pack_id, scenario_id, family_id, level, started_at, path_json)
         VALUES ('run-1', 'p', 'radio-a1', 'radio', 'A1', 1, '{"v":1,"steps":[]}')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO scenario_attempts (id, run_id, turn_id, attempt_no, kind, outcome, transcript, detail_json, created_at)
         VALUES ('att-1', 'run-1', 't01', 1, 'answer', 'matched', 'привет', '{}', 2)`,
      )
      .run();
    // §4.2 defaults: pinned false, media_local true.
    expect(
      sqlite.prepare('SELECT pinned, media_local FROM scenario_runs WHERE id = ?').get('run-1'),
    ).toEqual({ pinned: 0, media_local: 1 });
    sqlite.prepare("DELETE FROM scenario_runs WHERE id = 'run-1'").run();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM scenario_attempts').get()).toEqual({ n: 0 });
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
  });
});

const WORD_PROFILE_COLUMNS = [
  'id',
  'lemma_norm',
  'kind',
  'headword',
  'pos',
  'is_current',
  'payload',
  'provider',
  'model',
  'quality',
  'effort',
  'effort_applied',
  'prompt_tokens',
  'completion_tokens',
  'reasoning_tokens',
  'cost_usd',
  'duration_ms',
  'created_at',
];
const GRAMMAR_LESSON_COLUMNS = [
  'id',
  'lemma_norm',
  'kind',
  'headword',
  'section_id',
  'profile_id',
  'markdown',
  'provider',
  'model',
  'quality',
  'effort',
  'effort_applied',
  'prompt_tokens',
  'completion_tokens',
  'reasoning_tokens',
  'cost_usd',
  'duration_ms',
  'created_at',
];

/** T52 shape assertions shared by the fresh + upgrade cases (WORD_FORMS §2.2/§2.3). */
async function expectWordProfileTables(db: SumrakDB) {
  expect(await columnNames(db, 'word_profiles')).toEqual(WORD_PROFILE_COLUMNS);
  expect(await columnNames(db, 'grammar_lessons')).toEqual(GRAMMAR_LESSON_COLUMNS);
  expect(await indexNames(db, 'word_profiles')).toEqual(
    expect.arrayContaining(['word_profiles_key_idx', 'word_profiles_current_uq']),
  );
  expect(await indexNames(db, 'grammar_lessons')).toEqual(
    expect.arrayContaining(['grammar_lessons_key_idx', 'grammar_lessons_created_idx']),
  );
  // The partial unique index must keep its WHERE through drizzle-kit — the
  // versioning invariant (one current per key) rests on it.
  const idx = await db.all<{ name: string; unique: number; partial: number }>(
    sql.raw('PRAGMA index_list(word_profiles)'),
  );
  const current = idx.find((i) => i.name === 'word_profiles_current_uq');
  expect(current).toMatchObject({ unique: 1, partial: 1 });
  const master = await db.all<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'word_profiles_current_uq'`,
  );
  expect(master[0]!.sql).toMatch(/WHERE\s+is_current\s*=\s*1/i);
}

describe('0013_word-profiles upgrade from 0012', () => {
  it('creates both tables + indexes on a device that ran 0012; the partial index enforces one current per key', async () => {
    const { sqlite, db } = createDbUpTo('0012_review-source');
    const before = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('word_profiles', 'grammar_lessons')`,
    );
    expect(before).toEqual([]);

    migrate(drizzle(sqlite, { schema }), { migrationsFolder });

    await expectWordProfileTables(db);
    const insert = sqlite.prepare(
      `INSERT INTO word_profiles (id, lemma_norm, kind, headword, pos, is_current, payload, provider, model, quality, effort, effort_applied, duration_ms, created_at)
       VALUES (?, 'говорить', 'word', 'говорить', 'verb', ?, '{}', 'anthropic', 'm', 'normal', 'high', 1, 1, ?)`,
    );
    insert.run('wp-1', 1, 1);
    // A second CURRENT row for the same key is rejected by the partial index…
    expect(() => insert.run('wp-2', 1, 2)).toThrow(/UNIQUE/);
    // …while a non-current version of the same key is fine (old versions kept).
    insert.run('wp-3', 0, 3);
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
  });
});

describe('0012_review-source upgrade from 0011', () => {
  it('adds the nullable column + index; pre-existing grades read NULL', async () => {
    const { sqlite, db } = createDbUpTo('0011_library-categories');
    expect(await columnNames(db, 'review_log')).not.toContain('source');
    expect(await indexNames(db, 'review_log')).not.toContain('review_log_source_idx');

    // A bank item + card + grade written by the previous release.
    sqlite
      .prepare(
        `INSERT INTO bank_items (id, kind, lemma, lemma_norm, surface, normalized, translation, needs_enrichment, created_at)
         VALUES ('bi-old', 'word', 'дом', 'дом', 'дом', 'дом', 'house', 0, 0)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO cards (id, bank_item_id, direction, due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review_at, created_at)
         VALUES ('c-old', 'bi-old', 'ru-en', 0, 1, 5, 0, 0, 0, 1, 0, 1, 0, 0)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO review_log (id, card_id, rating, state, due_at, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, reviewed_at)
         VALUES ('rl-old', 'c-old', 3, 1, 0, 1, 5, 0, 0, 0, 0, 0)`,
      )
      .run();

    migrate(drizzle(sqlite, { schema }), { migrationsFolder });

    expect(await columnNames(db, 'review_log')).toContain('source');
    expect(await indexNames(db, 'review_log')).toContain('review_log_source_idx');
    const rows = await db.all<{ source: string | null }>(
      sql`SELECT source FROM review_log WHERE id = 'rl-old'`,
    );
    expect(rows[0]).toEqual({ source: null });
    const applied = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as {
      n: number;
    };
    expect(applied.n).toBe(journal.entries.length);
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
