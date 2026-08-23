import { z } from 'zod';

/**
 * Zod schema for the decrypted backup payload — the hard validation boundary
 * the restore flow enforces BEFORE any DB write (ticket DoD). Row shapes
 * mirror the Drizzle select types of the user tables in src/db/schema/user.ts
 * exactly (camelCase keys, JSON columns as parsed values). App-local, like
 * the T16 AI schemas: this contract is app ↔ its own archive, not shared
 * with the pipeline. `packages/schema` owns only the encrypted envelope.
 *
 * Strict everywhere: a payload with unknown keys or out-of-domain enum
 * values is refused whole (disaster-recovery code never "best-efforts" a
 * partial import). Future user-table changes bump PAYLOAD_VERSION.
 */

export const PAYLOAD_VERSION = 1;

const cefr = z.enum(['A1', 'A2', 'B1', 'B2', 'C1']);
const int = z.number().int();
const jsonRecord = z.record(z.string(), z.unknown());

const bankItemRow = z.strictObject({
  id: z.string(),
  kind: z.enum(['word', 'phrase']),
  lemma: z.string().nullable(),
  lemmaNorm: z.string().nullable(),
  surface: z.string(),
  normalized: z.string(),
  translation: z.string(),
  grammar: z.string().nullable(),
  pos: z.string().nullable(),
  level: cefr.nullable(),
  sourceSentenceId: z.string().nullable(),
  sourceStoryId: z.string().nullable(),
  note: z.string().nullable(),
  needsEnrichment: z.boolean(),
  createdAt: int,
});

const encounterRow = z.strictObject({
  id: z.string(),
  bankItemId: z.string(),
  sentenceId: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  surface: z.string(),
  createdAt: int,
});

const cardRow = z.strictObject({
  id: z.string(),
  bankItemId: z.string(),
  direction: z.enum(['ru-en', 'en-ru', 'listening', 'production']),
  dueAt: int,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: int,
  reps: int,
  lapses: int,
  state: int,
  lastReviewAt: int.nullable(),
  createdAt: int,
});

const reviewLogRow = z.strictObject({
  id: z.string(),
  cardId: z.string(),
  rating: int,
  state: int,
  dueAt: int,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  lastElapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: int,
  reviewedAt: int,
  durationMs: int.nullable(),
});

const journalEntryRow = z.strictObject({
  id: z.string(),
  promptId: z.string().nullable(),
  ru: z.string(),
  aiFeedback: z.string().nullable(),
  feedbackStatus: z.enum(['none', 'queued', 'done']),
  createdAt: int,
  updatedAt: int,
});

const noteRow = z.strictObject({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: int,
  updatedAt: int,
});

const checkpointResultRow = z.strictObject({
  id: z.string(),
  checkpointPackId: z.string(),
  scorePercent: z.number(),
  passed: z.boolean(),
  detail: jsonRecord.nullable(),
  completedAt: int,
});

const assessmentRow = z.strictObject({
  id: z.string(),
  payload: jsonRecord,
  createdAt: int,
});

const gameSessionRow = z.strictObject({
  id: z.string(),
  mode: z.string(),
  startedAt: int,
  endedAt: int.nullable(),
  itemCount: int,
  correctCount: int,
  detail: jsonRecord.nullable(),
});

const storyProgressRow = z.strictObject({
  packId: z.string(),
  storyId: z.string(),
  currentSentenceIdx: int,
  startedAt: int,
  updatedAt: int,
  finishedAt: int.nullable(),
});

const unitProgressRow = z.strictObject({
  packId: z.string(),
  lessonReadAt: int.nullable(),
  quizPassedAt: int.nullable(),
  quizBestScorePercent: z.number().nullable(),
  completedAt: int.nullable(),
  updatedAt: int,
});

const dailyActivityRow = z.strictObject({
  date: z.string(),
  reviewsDone: int,
  readingMs: int,
  storiesFinished: int,
  goalMetAt: int.nullable(),
  xp: int,
  updatedAt: int,
});

const frozenDayRow = z.strictObject({
  date: z.string(),
  consumedAt: int,
});

const achievementRow = z.strictObject({
  id: z.string(),
  unlockedAt: int,
});

const settingRow = z.strictObject({
  key: z.string(),
  value: z.unknown(),
  updatedAt: int,
});

const syncStateRow = z.strictObject({
  packId: z.string(),
  version: int,
  source: z.enum(['bundled', 'github', 'local-file']),
  installedAt: int,
  updatedAt: int,
  bytes: int.nullable(),
});

const analyticsEventRow = z.strictObject({
  id: int,
  event: z.string(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  createdAt: int,
});

export const BackupPayloadSchema = z.strictObject({
  /** Discriminator for the *decrypted* content (the envelope has its own). */
  format: z.literal('sumrak-backup-payload'),
  payloadVersion: z.literal(PAYLOAD_VERSION),
  /** Epoch ms of the export moment. */
  exportedAt: int,
  appVersion: z.string().optional(),
  tables: z.strictObject({
    bankItems: z.array(bankItemRow),
    encounters: z.array(encounterRow),
    cards: z.array(cardRow),
    reviewLog: z.array(reviewLogRow),
    journalEntries: z.array(journalEntryRow),
    notes: z.array(noteRow),
    checkpointResults: z.array(checkpointResultRow),
    assessments: z.array(assessmentRow),
    gameSessions: z.array(gameSessionRow),
    storyProgress: z.array(storyProgressRow),
    unitProgress: z.array(unitProgressRow),
    dailyActivity: z.array(dailyActivityRow),
    frozenDays: z.array(frozenDayRow),
    achievements: z.array(achievementRow),
    settings: z.array(settingRow),
    syncState: z.array(syncStateRow),
    analyticsEvents: z.array(analyticsEventRow),
  }),
});

export type BackupPayload = z.infer<typeof BackupPayloadSchema>;
export type BackupPayloadTables = BackupPayload['tables'];
export type UserTableKey = keyof BackupPayloadTables;

/** Payload keys ↔ SQLite table names, used by export/restore and drift tests. */
export const USER_TABLE_NAMES: Record<UserTableKey, string> = {
  bankItems: 'bank_items',
  encounters: 'encounters',
  cards: 'cards',
  reviewLog: 'review_log',
  journalEntries: 'journal_entries',
  notes: 'notes',
  checkpointResults: 'checkpoint_results',
  assessments: 'assessments',
  gameSessions: 'game_sessions',
  storyProgress: 'story_progress',
  unitProgress: 'unit_progress',
  dailyActivity: 'daily_activity',
  frozenDays: 'frozen_days',
  achievements: 'achievements',
  settings: 'settings',
  syncState: 'sync_state',
  analyticsEvents: 'analytics_events',
};
