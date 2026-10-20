import { sql } from 'drizzle-orm';
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { SETTING_KEYS } from '@/db/repositories/settings';
import * as syncSchema from '@/db/schema/sync';
import * as userSchema from '@/db/schema/user';

import {
  DEVICE_LOCAL_SETTING_KEYS,
  DEVICE_LOCAL_TABLES,
  DERIVED_TABLES,
  SPEC_BY_LOCAL,
  SYNCED_SERVER_TABLES,
  SYNCED_SETTING_KEYS,
  SYNCED_TABLES,
} from '../registry';

/**
 * PINNED copy of SumrakAPI/internal/sync/tables.go `Tables` (30 names). Change
 * both together (tables_test.go pins the Go side).
 */
const SERVER_TABLES_PINNED = [
  'review_log',
  'encounters',
  'game_sessions',
  'analytics_events',
  'scenario_attempts',
  'exam_responses',
  'course_attempts',
  'checkpoint_results',
  'assessments',
  'cards',
  'exam_item_cards',
  'story_progress',
  'unit_progress',
  'course_progress',
  'achievements',
  'frozen_days',
  'dialogue_endings_seen',
  'leech_dismissals',
  'bank_items',
  'journal_entries',
  'notes',
  'bookmarks',
  'dialogue_runs',
  'scenario_runs',
  'exam_attempts',
  'word_profiles',
  'grammar_lessons',
  'daily_quests',
  'daily_activity',
  'settings',
].sort();

function tablesOf(mod: Record<string, unknown>): string[] {
  return Object.values(mod)
    .filter((v): v is SQLiteTable => is(v, SQLiteTable))
    .map((t) => getTableName(t));
}

describe('sync registry drift guard', () => {
  it('classifies every sqliteTable in user.ts and sync.ts', () => {
    const classified = new Set<string>([
      ...SYNCED_TABLES.map((t) => t.name),
      ...DEVICE_LOCAL_TABLES,
      ...DERIVED_TABLES,
    ]);
    const all = [...tablesOf(userSchema), ...tablesOf(syncSchema)];
    expect(all.length).toBeGreaterThan(35);
    const missing = all.filter((t) => !classified.has(t));
    expect(missing).toEqual([]);
  });

  it('classifies every SETTING_KEYS value exactly once', () => {
    for (const key of Object.values(SETTING_KEYS)) {
      const local = DEVICE_LOCAL_SETTING_KEYS.has(key);
      const synced = SYNCED_SETTING_KEYS.has(key);
      expect({ key, local, synced }).toSatisfy(
        (v: { local: boolean; synced: boolean }) => v.local !== v.synced,
      );
    }
    // No stale entries either.
    const known = new Set<string>(Object.values(SETTING_KEYS));
    for (const k of [...DEVICE_LOCAL_SETTING_KEYS, ...SYNCED_SETTING_KEYS]) {
      expect(known.has(k)).toBe(true);
    }
  });

  it('synced server tables are exactly the server allowlist (pinned copy)', () => {
    expect(SYNCED_SERVER_TABLES).toEqual(SERVER_TABLES_PINNED);
    expect(SERVER_TABLES_PINNED).toHaveLength(30);
  });

  it('matches SumrakAPI tables.go when the sibling repo is checked out', () => {
    const p = path.resolve(__dirname, '../../../../../../../SumrakAPI/internal/sync/tables.go');
    if (!fs.existsSync(p)) return; // pinned copy above is the always-on guard
    const src = fs.readFileSync(p, 'utf8');
    const names = [...src.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    expect(names).toEqual(SERVER_TABLES_PINNED);
  });

  it('registry primary keys equal PRAGMA table_info pk order', async () => {
    const db = createTestDb();
    for (const t of SYNCED_TABLES) {
      const info = await db.all<{ name: string; pk: number }>(
        sql.raw(`PRAGMA table_info(${t.name})`),
      );
      const pk = info
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      expect({ t: t.name, pk: t.pk }).toEqual({ t: t.name, pk });
    }
  });

  it('every monotonic field rule names a real column', async () => {
    const db = createTestDb();
    for (const t of SYNCED_TABLES.filter((s) => s.cls === 'monotonic')) {
      const info = await db.all<{ name: string; pk: number }>(
        sql.raw(`PRAGMA table_info(${t.name})`),
      );
      const nonPk = info
        .filter((c) => c.pk === 0)
        .map((c) => c.name)
        .sort();
      expect({ t: t.name, f: Object.keys(t.fields ?? {}).sort() }).toEqual({
        t: t.name,
        f: nonPk,
      });
    }
    expect(SPEC_BY_LOCAL.get('story_progress')?.cls).toBe('monotonic');
  });
});
