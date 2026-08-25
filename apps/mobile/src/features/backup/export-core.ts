import { sql } from 'drizzle-orm';

import {
  achievements,
  analyticsEvents,
  assessments,
  bankItems,
  bookmarks,
  cards,
  checkpointResults,
  dailyActivity,
  encounters,
  frozenDays,
  gameSessions,
  journalEntries,
  notes,
  reviewLog,
  settings,
  storyProgress,
  syncState,
  unitProgress,
} from '@/db/schema';
import type { SumrakDB } from '@/db/types';

import { BackupPayloadSchema, PAYLOAD_VERSION, type BackupPayload } from './payload-schema';

/**
 * Export the user-table group (design §5 — never content tables) as a
 * validated payload object. All reads happen inside one transaction, so the
 * snapshot is consistent even if a review/autosave lands mid-export (the
 * live-write race from the ticket's risk notes; WAL readers see a stable
 * view). The result is Zod-parsed before returning — schema drift between
 * the DB and the payload schema fails loudly at BACKUP time, not years
 * later at restore time.
 */

/**
 * Defense-in-depth: no secret is ever stored in `settings` by construction
 * (PAT + AI key live in expo-secure-store), but the export still refuses to
 * ship any settings value that looks like one. Patterns cover GitHub tokens
 * (fine-grained + classic) and OpenRouter/Anthropic keys.
 */
const SECRET_VALUE_RE = /github_pat_|ghp_[A-Za-z0-9]|gho_|ghu_|ghs_|ghr_|sk-or-|sk-ant-/;

export interface ExportResult {
  payload: BackupPayload;
  /** Settings rows dropped by the secret filter (count only — never values). */
  secretsDropped: number;
}

export async function exportUserData(
  db: SumrakDB,
  opts: { appVersion?: string; now?: Date } = {},
): Promise<ExportResult> {
  await db.run(sql`BEGIN`);
  let tables;
  try {
    tables = {
      bankItems: await db.select().from(bankItems),
      encounters: await db.select().from(encounters),
      cards: await db.select().from(cards),
      reviewLog: await db.select().from(reviewLog),
      journalEntries: await db.select().from(journalEntries),
      notes: await db.select().from(notes),
      checkpointResults: await db.select().from(checkpointResults),
      assessments: await db.select().from(assessments),
      gameSessions: await db.select().from(gameSessions),
      storyProgress: await db.select().from(storyProgress),
      unitProgress: await db.select().from(unitProgress),
      dailyActivity: await db.select().from(dailyActivity),
      frozenDays: await db.select().from(frozenDays),
      achievements: await db.select().from(achievements),
      bookmarks: await db.select().from(bookmarks),
      settings: await db.select().from(settings),
      syncState: await db.select().from(syncState),
      analyticsEvents: await db.select().from(analyticsEvents),
    };
    await db.run(sql`COMMIT`);
  } catch (err) {
    await db.run(sql`ROLLBACK`);
    throw err;
  }

  const safeSettings = tables.settings.filter((row) => {
    try {
      return !SECRET_VALUE_RE.test(JSON.stringify(row.value) ?? '');
    } catch {
      return false; // unserializable value — can't ship what we can't inspect
    }
  });
  const secretsDropped = tables.settings.length - safeSettings.length;

  // Zod-parse the assembled object (rather than trusting TS): the runtime
  // check narrows plain-string DB columns (e.g. sync_state.source) into the
  // payload's enum domains, and any drift fails loudly here.
  const payload: BackupPayload = BackupPayloadSchema.parse({
    format: 'sumrak-backup-payload',
    payloadVersion: PAYLOAD_VERSION,
    exportedAt: (opts.now ?? new Date()).getTime(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    tables: { ...tables, settings: safeSettings },
  });

  return { payload, secretsDropped };
}
