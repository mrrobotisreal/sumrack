import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  achievements,
  analyticsEvents,
  assessments,
  bankItems,
  cards,
  checkpointResults,
  dailyActivity,
  encounters,
  frozenDays,
  gameSessions,
  journalEntries,
  notes,
  packs,
  reviewLog,
  settings,
  storyProgress,
  syncState,
  unitProgress,
} from '@/db/schema';
import type { SumrakDB } from '@/db/types';

import { BackupError } from './errors';
import { BackupPayloadSchema, type BackupPayload, type UserTableKey } from './payload-schema';

/**
 * Replace-on-restore import of a backup payload (ticket item 8: this is a
 * disaster-recovery flow — the restored snapshot *becomes* the user data;
 * merging two histories is a correctness minefield deliberately avoided).
 *
 * Safety properties:
 * - The payload is Zod-validated BEFORE the transaction opens; an invalid
 *   payload throws with zero writes.
 * - Delete + insert happen in ONE transaction — any failure rolls back to
 *   the exact pre-restore state (wrong-passphrase failures never even reach
 *   here; they die at decrypt).
 * - Content tables are never touched. The one cross-group step is the
 *   sync_state reconciliation: restored rows claiming a (pack, version) the
 *   content tables don't actually hold are deleted, so the next content
 *   sync re-downloads exactly what's missing (design §9 restore step).
 */

/** Parent tables before children (FK order); deletes run in reverse. */
const INSERT_ORDER: [UserTableKey, SQLiteTable][] = [
  ['bankItems', bankItems],
  ['cards', cards],
  ['reviewLog', reviewLog],
  ['encounters', encounters],
  ['journalEntries', journalEntries],
  ['notes', notes],
  ['checkpointResults', checkpointResults],
  ['assessments', assessments],
  ['gameSessions', gameSessions],
  ['storyProgress', storyProgress],
  ['unitProgress', unitProgress],
  ['dailyActivity', dailyActivity],
  ['frozenDays', frozenDays],
  ['achievements', achievements],
  ['settings', settings],
  ['syncState', syncState],
  ['analyticsEvents', analyticsEvents],
];

export interface RestoreResult {
  rowCounts: Record<UserTableKey, number>;
  totalRows: number;
  /** Restored sync_state rows removed because their content isn't installed → re-download list. */
  packsToRedownload: string[];
  exportedAt: number;
}

/** Validate an unknown decrypted payload; throws BackupError('invalid-payload'). */
export function parseBackupPayload(raw: unknown): BackupPayload {
  const result = BackupPayloadSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new BackupError(
      'invalid-payload',
      first ? `${first.path.join('.')}: ${first.message}` : 'payload failed validation',
    );
  }
  return result.data;
}

export async function restoreUserData(db: SumrakDB, raw: unknown): Promise<RestoreResult> {
  const payload = parseBackupPayload(raw);
  const { tables } = payload;

  let packsToRedownload: string[] = [];
  await db.run(sql`BEGIN`);
  try {
    for (const [, table] of [...INSERT_ORDER].reverse()) {
      await db.delete(table);
    }
    for (const [key, table] of INSERT_ORDER) {
      await insertAll(db, table, tables[key]);
    }

    // sync_state reconciliation: keep only rows whose exact (pack, version)
    // content rows are actually present right now.
    const installedPacks = await db.select({ id: packs.id, version: packs.version }).from(packs);
    const present = new Set(installedPacks.map((p) => `${p.id}@${p.version}`));
    const stale = tables.syncState.filter((row) => !present.has(`${row.packId}@${row.version}`));
    for (const row of stale) {
      await db.delete(syncState).where(sql`pack_id = ${row.packId}`);
    }
    packsToRedownload = stale.map((row) => row.packId);

    await db.run(sql`COMMIT`);
  } catch (err) {
    await db.run(sql`ROLLBACK`);
    throw err;
  }

  const rowCounts = Object.fromEntries(
    INSERT_ORDER.map(([key]) => [key, tables[key].length]),
  ) as Record<UserTableKey, number>;
  return {
    rowCounts,
    totalRows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
    packsToRedownload,
    exportedAt: payload.exportedAt,
  };
}

/**
 * Chunked multi-row insert under SQLite's bound-parameter limit — sized to
 * the historical 999-variable floor so it's safe on any SQLite build (the
 * importer uses the same approach).
 */
async function insertAll(db: SumrakDB, table: SQLiteTable, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0] as Record<string, unknown>).length;
  const chunkSize = Math.max(1, Math.floor(900 / cols));
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(table).values(rows.slice(i, i + chunkSize) as never);
  }
}
