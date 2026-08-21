import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from './helpers';

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
});
