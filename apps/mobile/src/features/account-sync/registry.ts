/**
 * The sync table registry (T104, ACCOUNTS_AND_SYNC §5.2). ONE source of truth
 * for which user tables sync and how they merge. Pure data: no native imports,
 * so `scripts/gen-sync-triggers.ts` (run by tsx) and vitest can load it.
 *
 * Drift guards (`__tests__/registry.test.ts`): every `sqliteTable` in
 * db/schema/user.ts + sync.ts is classified here, every SETTING_KEYS value is
 * classified synced / device-local, and the synced server table names equal
 * SumrakAPI/internal/sync/tables.go.
 */
export type SyncClass =
  | 'append-only' // insert if absent; never conflicts (random ids)
  | 'fsrs' // LWW row + replay of the merged review log (cards)
  | 'monotonic' // field-wise merge, never moves backwards
  | 'lww' // higher (hlc, deviceId) wins
  | 'per-device' // one record per (date, device); merged locally by summing
  | 'settings' // per key LWW; device-local keys excluded
  | 'device-local'; // never synced

export interface NaturalKey {
  /** Local columns that identify the same logical row on two phones. */
  cols: string[];
  /** Applies only when this holds for the incoming row (partial unique index). */
  when?: (row: Record<string, unknown>) => boolean;
  /** SQL condition (no params) restricting the local lookup to the same partial index. */
  sqlWhere?: string;
}

export type MonotonicRule = 'max' | 'min' | 'maxNonNull' | 'minNonNull' | 'local';

export interface TableSpec {
  /** Local SQLite table the triggers sit on. */
  name: string;
  cls: SyncClass;
  /** Local primary-key columns in schema order (a test pins them to PRAGMA table_info). */
  pk: string[];
  /** Server `tbl` name (the allowlist in tables.go); defaults to `name`. */
  serverTbl?: string;
  naturalKeys?: NaturalKey[];
  /** monotonic: per-column rule for every non-pk column. */
  fields?: Record<string, MonotonicRule>;
  /** Columns never overwritten from a remote row (device-specific state). */
  localOnlyCols?: string[];
  /** Insert-only table (no UPDATE/DELETE triggers). */
  insertOnly?: boolean;
}

const A = (name: string, extra: Partial<TableSpec> = {}): TableSpec => ({
  name,
  cls: 'append-only',
  pk: ['id'],
  ...extra,
});
const L = (name: string, pk: string[] = ['id'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name,
  cls: 'lww',
  pk,
  ...extra,
});

export const SYNCED_TABLES: TableSpec[] = [
  // ---- append-only
  A('review_log'),
  A('encounters'),
  A('game_sessions'),
  A('analytics_events', { insertOnly: true }),
  A('scenario_attempts'),
  A('exam_responses', { naturalKeys: [{ cols: ['attempt_id', 'subtest_id', 'item_id'] }] }),
  A('course_attempts'),
  A('checkpoint_results'),
  A('assessments'),
  // ---- FSRS state
  {
    name: 'cards',
    cls: 'fsrs',
    pk: ['id'],
    naturalKeys: [{ cols: ['bank_item_id', 'direction'] }],
  },
  // v1 deviation (T104 addendum H): the exam deck stays plain LWW.
  { name: 'exam_item_cards', cls: 'fsrs', pk: ['item_key'] },
  // ---- monotonic
  {
    name: 'story_progress',
    cls: 'monotonic',
    pk: ['pack_id', 'story_id'],
    fields: {
      current_sentence_idx: 'max',
      started_at: 'min',
      updated_at: 'max',
      finished_at: 'minNonNull',
    },
  },
  {
    name: 'unit_progress',
    cls: 'monotonic',
    pk: ['pack_id'],
    fields: {
      lesson_read_at: 'minNonNull',
      quiz_passed_at: 'minNonNull',
      quiz_best_score_percent: 'maxNonNull',
      completed_at: 'minNonNull',
      updated_at: 'max',
    },
  },
  {
    name: 'course_progress',
    cls: 'monotonic',
    pk: ['key'],
    fields: {
      pack_id: 'local',
      unit_id: 'local',
      best_percent: 'max',
      passed_at: 'minNonNull',
      passed_via: 'local', // follows passed_at (see mergeMonotonic)
      attempts: 'max',
      last_attempt_at: 'maxNonNull',
      cooldown_until: 'maxNonNull',
      updated_at: 'max',
    },
  },
  { name: 'achievements', cls: 'monotonic', pk: ['id'], fields: { unlocked_at: 'min' } },
  { name: 'frozen_days', cls: 'monotonic', pk: ['date'], fields: { consumed_at: 'min' } },
  {
    name: 'dialogue_endings_seen',
    cls: 'monotonic',
    pk: ['dialogue_id', 'ending_id'],
    fields: { first_seen_at: 'min' },
  },
  { name: 'leech_dismissals', cls: 'monotonic', pk: ['card_id'], fields: { dismissed_at: 'max' } },
  // ---- LWW rows
  L('bank_items', ['id'], {
    naturalKeys: [
      {
        cols: ['lemma_norm'],
        when: (r) => r.kind === 'word' && r.lemma_norm != null,
        sqlWhere: "kind = 'word' AND lemma_norm IS NOT NULL",
      },
      { cols: ['normalized'], when: (r) => r.kind === 'phrase', sqlWhere: "kind = 'phrase'" },
    ],
  }),
  L('journal_entries'),
  L('notes'),
  L('bookmarks', ['id'], {
    naturalKeys: [
      {
        cols: ['pack_id', 'story_id'],
        when: (r) => r.kind === 'story',
        sqlWhere: "kind = 'story'",
      },
      {
        cols: ['pack_id', 'sentence_id'],
        when: (r) => r.kind === 'sentence',
        sqlWhere: "kind = 'sentence'",
      },
    ],
  }),
  L('dialogue_runs'),
  L('scenario_runs', ['id'], {
    localOnlyCols: ['media_local', 'media_bundle_state', 'media_bundle_name'],
  }),
  L('exam_attempts'),
  L('word_profiles', ['id'], {
    naturalKeys: [
      {
        cols: ['lemma_norm', 'kind'],
        when: (r) => r.is_current === 1 || r.is_current === true,
        sqlWhere: 'is_current = 1',
      },
    ],
  }),
  L('grammar_lessons'),
  L('daily_quests', ['date']),
  // ---- per-device: the local table is `daily_activity_own`, synced as `daily_activity`
  {
    name: 'daily_activity_own',
    serverTbl: 'daily_activity',
    cls: 'per-device',
    pk: ['date'],
  },
  // ---- settings (device-local keys filtered, see isDeviceLocalSetting)
  { name: 'settings', cls: 'settings', pk: ['key'] },
];

/** Tables that exist locally but are never synced (and never in a backup unless a user table). */
export const DEVICE_LOCAL_TABLES: string[] = [
  'sync_state',
  'imported_packs',
  'import_requests',
  'sync_outbox',
  'sync_control',
  'sync_clock',
  'sync_id_map',
  'sync_parked',
  'sync_row_hlc',
  'sync_dirty_cards',
  'daily_activity_peers',
];

/** `daily_activity` = the merged totals every reader uses (own + peers). Never itself synced. */
export const DERIVED_TABLES: string[] = ['daily_activity'];

/** Infra tables created by migration 0023: not user data, never in a backup payload. */
export const SYNC_INFRA_TABLES: string[] = [
  'sync_outbox',
  'sync_control',
  'sync_clock',
  'sync_id_map',
  'sync_parked',
  'sync_row_hlc',
  'sync_dirty_cards',
  'daily_activity_own',
  'daily_activity_peers',
];

export const SPEC_BY_LOCAL: ReadonlyMap<string, TableSpec> = new Map(
  SYNCED_TABLES.map((t) => [t.name, t]),
);
export const SPEC_BY_SERVER: ReadonlyMap<string, TableSpec> = new Map(
  SYNCED_TABLES.map((t) => [t.serverTbl ?? t.name, t]),
);
export const serverTable = (t: TableSpec): string => t.serverTbl ?? t.name;

/** Every server table name the registry syncs (≡ SumrakAPI internal/sync/tables.go). */
export const SYNCED_SERVER_TABLES: string[] = SYNCED_TABLES.map(serverTable).sort();

/** The classes whose pulled rows are gated by (hlc, deviceId). */
export const isGated = (t: TableSpec): boolean =>
  t.cls === 'lww' || t.cls === 'fsrs' || t.cls === 'settings';

// ---------------------------------------------------------------- settings

/** Settings keys that never leave (or enter) this phone. Every SETTING_KEYS value is in exactly one set. */
export const DEVICE_LOCAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  'sync.deviceId',
  'sync.cursor',
  'sync.lastSyncAt',
  'sync.serverUrl',
  'sync.linked',
  'sync.contentRepo',
  'sync.wifiOnlyAudio',
  'sync.lastCheckAt',
  'auth.skipped',
  'bootstrapDone',
  'themeMode',
  'motion.reduce',
  'lastBackup.github',
  'lastBackup.syncd',
  'lastBackup.local',
  'backup.prefs',
  'backup.kdf',
  'backup.safDirUri',
  'backup.syncd',
  'listening.audioFlags',
  'listen.progress',
  'listen.prefs',
  'audio.ambient',
  'audio.ambientCursors',
  'notifications.prefs',
  'notifications.promptDismissed',
  'scenario.assistBannerDismissed',
  'scenario.recordings',
  'scenario.backupHintShown',
  'scenario.assistModel',
  'torfl.media',
  'grammar.batch',
  'review.dueSnapshotDay',
  'hotel.retiredCheckpoint',
]);

/** Settings that follow the learner to every phone (per-key LWW). */
export const SYNCED_SETTING_KEYS: ReadonlySet<string> = new Set([
  'pathPosition',
  'readerTypography',
  'encounterOnLookup',
  'narration.prefs',
  'tts.voice',
  'games.clozeUnseenStoriesAllowed',
  'games.dialogueTapMode',
  'games.typingStats',
  'games.blitzStats',
  'library.filter',
  'library.expanded',
  'hotel.sfx',
  'hotel.lastFloor',
  'hotel.lessonPos',
  'bank.sort',
  'dailySession.prefs',
  'path.checkpointPassThreshold',
  'ai.model',
  'ai.grammarPreset',
  'ai.modelTable',
  'grammar.stats',
  'goal.daily',
  'streak.freeze',
  'scenario.prefs',
  'torfl.prefs',
  'torfl.examDate',
  'torfl.examDateA2',
  'torfl.gradingPreset',
  'fsrs.desiredRetention',
  'fsrs.params',
  'review.queuePrefs',
]);

/** Prefixes that are device-local even for keys a future ticket adds without classifying. */
const LOCAL_PREFIXES = ['sync.', 'auth.'];

export function isDeviceLocalSetting(key: string): boolean {
  return DEVICE_LOCAL_SETTING_KEYS.has(key) || LOCAL_PREFIXES.some((p) => key.startsWith(p));
}
