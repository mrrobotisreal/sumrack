import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * M29 / T104 sync infrastructure. ALL of these are device-local: never
 * synced, never in a backup (features/account-sync/registry.ts classifies
 * them). Triggers that feed `sync_outbox` are generated from the registry
 * (scripts/gen-sync-triggers.ts) and live in migration 0023_sync.
 */

/** Pending changes. Stores no row data: the CURRENT row is read at push time. */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Local table name (e.g. `daily_activity_own`). */
    tbl: text('tbl').notNull(),
    /** JSON array of the local primary-key values, in schema order. */
    pk: text('pk').notNull(),
    op: text('op').$type<'upsert' | 'delete'>().notNull(),
    hlc: integer('hlc').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('sync_outbox_tbl_pk_idx').on(t.tbl, t.pk)],
);

/** One row. `applying = 1` while a pulled chunk is written, so triggers stay silent. */
export const syncControl = sqliteTable('sync_control', {
  id: integer('id').primaryKey(),
  applying: integer('applying').notNull().default(0),
});

/** One row: the hybrid-logical clock's last value (ms-scale, strictly increasing). */
export const syncClock = sqliteTable('sync_clock', {
  id: integer('id').primaryKey(),
  last: integer('last').notNull().default(0),
});

/** Natural-key collisions: remote record pk -> the local row it was merged onto. */
export const syncIdMap = sqliteTable(
  'sync_id_map',
  {
    tbl: text('tbl').notNull(),
    remotePk: text('remote_pk').notNull(),
    localPk: text('local_pk').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tbl, t.remotePk] }),
    index('sync_id_map_local_idx').on(t.tbl, t.localPk),
  ],
);

/** Pulled changes that could not be applied yet (missing FK parent, ...). Retried every run. */
export const syncParked = sqliteTable(
  'sync_parked',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tbl: text('tbl').notNull(),
    pk: text('pk').notNull(),
    op: text('op').$type<'upsert' | 'delete'>().notNull(),
    data: text('data'),
    hlc: integer('hlc').notNull(),
    deviceId: text('device_id').notNull(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    parkedAt: integer('parked_at').notNull(),
  },
  (t) => [uniqueIndex('sync_parked_tbl_pk_uq').on(t.tbl, t.pk)],
);

/** THIS phone's daily-activity contributions (`daily_activity` is the merged total). */
export const dailyActivityOwn = sqliteTable('daily_activity_own', {
  date: text('date').primaryKey(),
  reviewsDone: integer('reviews_done').notNull().default(0),
  readingMs: integer('reading_ms').notNull().default(0),
  storiesFinished: integer('stories_finished').notNull().default(0),
  goalMetAt: integer('goal_met_at'),
  xp: integer('xp').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

/** Other phones' daily-activity contributions. */
export const dailyActivityPeers = sqliteTable(
  'daily_activity_peers',
  {
    date: text('date').notNull(),
    deviceId: text('device_id').notNull(),
    reviewsDone: integer('reviews_done').notNull().default(0),
    readingMs: integer('reading_ms').notNull().default(0),
    storiesFinished: integer('stories_finished').notNull().default(0),
    goalMetAt: integer('goal_met_at'),
    xp: integer('xp').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.deviceId] })],
);

/**
 * Last known server clock `(hlc, device_id)` of a LWW/FSRS/settings row — the
 * gate a pulled change must beat. Written from every pulled record (own echoes
 * included) and from acked pushes; a pending outbox entry also counts.
 */
export const syncRowHlc = sqliteTable(
  'sync_row_hlc',
  {
    tbl: text('tbl').notNull(),
    pk: text('pk').notNull(),
    hlc: integer('hlc').notNull(),
    deviceId: text('device_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tbl, t.pk] })],
);
