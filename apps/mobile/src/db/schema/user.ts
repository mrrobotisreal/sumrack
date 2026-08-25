import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * User tables — precious, backed up (T20), and never touched by content
 * reimport. References into content (`sourceSentenceId`, `sourceStoryId`,
 * prompt/pack ids) are plain stable-id strings with NO enforced foreign
 * keys: content rows may be replaced or removed at any time and user rows
 * must survive (design §4.3/§5). FKs are only used *within* the user group
 * (encounters/cards/review_log → bank_items/cards).
 */

export type BankItemKind = 'word' | 'phrase';
export type CardDirection = 'ru-en' | 'en-ru' | 'listening' | 'production';
export type FeedbackStatus = 'none' | 'queued' | 'done';

export const bankItems = sqliteTable(
  'bank_items',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<BankItemKind>().notNull(),
    /** Dictionary form — words only (identity for dedup); null for phrases. */
    lemma: text('lemma'),
    /** ё/е-folded, lowercased, NFC lemma — the actual word-dedup key. */
    lemmaNorm: text('lemma_norm'),
    /** Surface form as first encountered / entered. */
    surface: text('surface').notNull(),
    /** Normalized phrase text (NFC, casefold, ё→е, whitespace-collapsed) — phrase dedup key. */
    normalized: text('normalized').notNull(),
    translation: text('translation').notNull(),
    grammar: text('grammar'),
    pos: text('pos'),
    level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>(),
    /** Stable content refs (strings, unenforced — survive pack updates/removal). */
    sourceSentenceId: text('source_sentence_id'),
    sourceStoryId: text('source_story_id'),
    note: text('note'),
    /** Captured outside packs with only a surface form; AI fills the rest later (§7.4). */
    needsEnrichment: integer('needs_enrichment', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('bank_items_word_lemma_uq')
      .on(t.lemmaNorm)
      .where(sql`kind = 'word' AND lemma_norm IS NOT NULL`),
    uniqueIndex('bank_items_phrase_norm_uq')
      .on(t.normalized)
      .where(sql`kind = 'phrase'`),
    index('bank_items_created_idx').on(t.createdAt),
  ],
);

export const encounters = sqliteTable(
  'encounters',
  {
    id: text('id').primaryKey(),
    bankItemId: text('bank_item_id')
      .notNull()
      .references(() => bankItems.id, { onDelete: 'cascade' }),
    /** Stable content ref (unenforced). */
    sentenceId: text('sentence_id'),
    journalEntryId: text('journal_entry_id'),
    /** Surface form as it appeared at this encounter. */
    surface: text('surface').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('encounters_bank_item_idx').on(t.bankItemId)],
);

/**
 * FSRS scheduling state: one card per (bank item × direction). Columns
 * mirror ts-fsrs's `Card` structure 1:1 so T06 can hydrate/persist without
 * a schema migration. T03 creates rows/tables only — no scheduling logic.
 */
export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    bankItemId: text('bank_item_id')
      .notNull()
      .references(() => bankItems.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<CardDirection>().notNull(),
    /** ts-fsrs Card.due (epoch ms). */
    dueAt: integer('due_at').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    /** ts-fsrs State enum: 0 New · 1 Learning · 2 Review · 3 Relearning. */
    state: integer('state').notNull(),
    lastReviewAt: integer('last_review_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('cards_item_direction_uq').on(t.bankItemId, t.direction),
    index('cards_due_idx').on(t.dueAt),
  ],
);

/** Full review history, ts-fsrs `ReviewLog`-shaped (append-only). */
export const reviewLog = sqliteTable(
  'review_log',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** ts-fsrs Rating: 1 Again · 2 Hard · 3 Good · 4 Easy. */
    rating: integer('rating').notNull(),
    state: integer('state').notNull(),
    dueAt: integer('due_at').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    lastElapsedDays: real('last_elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    reviewedAt: integer('reviewed_at').notNull(),
    /** How long the answer took, when the game measured it (analytics/rating mapping). */
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId, t.reviewedAt),
    // T22 perf: the backup activity probe filters on reviewed_at alone —
    // without this it full-scans the append-only history on every
    // significant-session check.
    index('review_log_reviewed_at_idx').on(t.reviewedAt),
  ],
);

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    /** Stable prompt id from a prompts pack (unenforced ref). */
    promptId: text('prompt_id'),
    ru: text('ru').notNull(),
    aiFeedback: text('ai_feedback'),
    feedbackStatus: text('feedback_status').$type<FeedbackStatus>().notNull().default('none'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('journal_entries_created_idx').on(t.createdAt),
    // T22 perf: activity probe filters on updated_at (notes already index
    // updated_at; journal only indexed created_at).
    index('journal_entries_updated_idx').on(t.updatedAt),
  ],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** Markdown body. */
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('notes_updated_idx').on(t.updatedAt)],
);

export const checkpointResults = sqliteTable('checkpoint_results', {
  id: text('id').primaryKey(),
  /** Stable id of the checkpoint pack taken (unenforced ref). */
  checkpointPackId: text('checkpoint_pack_id').notNull(),
  scorePercent: real('score_percent').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  /** Per-exercise outcomes, shape owned by T17. */
  detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
  completedAt: integer('completed_at').notNull(),
});

/** AI CEFR assessments (§7.6) — payload shape owned by T18; kept opaque here. */
export const assessments = sqliteTable('assessments', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at').notNull(),
});

export const gameSessions = sqliteTable(
  'game_sessions',
  {
    id: text('id').primaryKey(),
    /** Game mode or 'daily' for the unified session (T14). */
    mode: text('mode').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    itemCount: integer('item_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    /** Mode-specific extras (pronunciation scores etc.) — owned by later tickets. */
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('game_sessions_started_idx').on(t.startedAt)],
);

/**
 * Reading progress per story (T04). Keyed (packId, storyId) — story ids are
 * only unique within their pack. User-owned: the ids are unenforced content
 * refs, so progress survives pack reimport (same stable ids) and removal.
 */
export const storyProgress = sqliteTable(
  'story_progress',
  {
    packId: text('pack_id').notNull(),
    storyId: text('story_id').notNull(),
    /** orderIdx of the topmost visible sentence — the restore point. */
    currentSentenceIdx: integer('current_sentence_idx').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Set when the story end is first reached; rereads never clear it. */
    finishedAt: integer('finished_at'),
  },
  (t) => [primaryKey({ columns: [t.packId, t.storyId] })],
);

/**
 * Guided-path unit progress (T17). Stores ONLY the facts that cannot be
 * derived from other state: lesson opened/read, unit-quiz outcome, and the
 * first-completion moment (celebration + analytics fire once). Story
 * completion and the review goal are derived live from `story_progress` /
 * cards at read time, so Library-first, out-of-order usage earns unit
 * credit with no special-casing (ticket's key correctness requirement).
 * `packId` is an unenforced content ref, like every user-table ref.
 */
export const unitProgress = sqliteTable('unit_progress', {
  packId: text('pack_id').primaryKey(),
  /** First time the lesson screen was read to the end (or explicitly marked). */
  lessonReadAt: integer('lesson_read_at'),
  /** First time the unit quiz met the pass threshold. */
  quizPassedAt: integer('quiz_passed_at'),
  /** Best unit-quiz score so far, 0–100. */
  quizBestScorePercent: real('quiz_best_score_percent'),
  /** Set once, when every completion condition first held simultaneously. */
  completedAt: integer('completed_at'),
  updatedAt: integer('updated_at').notNull(),
});

/** Per-local-day counters feeding streaks/goals (§7.7). Date = 'YYYY-MM-DD' device-local. */
export const dailyActivity = sqliteTable('daily_activity', {
  date: text('date').primaryKey(),
  reviewsDone: integer('reviews_done').notNull().default(0),
  readingMs: integer('reading_ms').notNull().default(0),
  storiesFinished: integer('stories_finished').notNull().default(0),
  /**
   * Stamped once (epoch ms), the first moment the day's counters reached the
   * daily goal that was configured AT THAT MOMENT (T19). Never re-evaluated
   * retroactively when the goal config changes — history stays honest.
   */
  goalMetAt: integer('goal_met_at'),
  /** XP earned this local day (T19) — total XP = SUM over all rows. */
  xp: integer('xp').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Days covered by a consumed streak-freeze (T19, §7.7). A frozen day counts
 * as goal-met in the streak walk; the row is the audit record of when the
 * freeze was spent. Freeze inventory itself lives in `settings`
 * (`streak.freeze`) — this table is only the per-day coverage.
 */
export const frozenDays = sqliteTable('frozen_days', {
  date: text('date').primaryKey(),
  consumedAt: integer('consumed_at').notNull(),
});

export const achievements = sqliteTable('achievements', {
  /** Achievement key, e.g. "first-story" (set owned by T19). */
  id: text('id').primaryKey(),
  unlockedAt: integer('unlocked_at').notNull(),
});

export type BookmarkKind = 'story' | 'sentence';

/**
 * Story/sentence bookmarks (T24, V2 §7.1). Content refs are stable-id
 * strings, unenforced like every user-table ref — a bookmark survives pack
 * reimport and degrades gracefully (never crashes) when its pack is removed.
 * `sentenceId` is set exactly for kind='sentence'; sentence ids are unique
 * pack-wide (design §4.2), so (packId, sentenceId) identifies the row.
 */
export const bookmarks = sqliteTable(
  'bookmarks',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<BookmarkKind>().notNull(),
    packId: text('pack_id').notNull(),
    storyId: text('story_id').notNull(),
    sentenceId: text('sentence_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('bookmarks_story_uq')
      .on(t.packId, t.storyId)
      .where(sql`kind = 'story'`),
    uniqueIndex('bookmarks_sentence_uq')
      .on(t.packId, t.sentenceId)
      .where(sql`kind = 'sentence'`),
    index('bookmarks_created_idx').on(t.createdAt),
  ],
);

/** Key-value settings (JSON-encoded values), incl. theme mode and path position. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Installed-pack record (user-owned so restore knows what to re-download
 * even when content tables are empty, §9). Backup ids live in `settings`
 * under `lastBackup.*` keys — see the syncState repository.
 */
export const syncState = sqliteTable('sync_state', {
  packId: text('pack_id').primaryKey(),
  version: integer('version').notNull(),
  /** Where the pack came from: 'bundled' | 'github' | 'local-file'. */
  source: text('source').notNull(),
  installedAt: integer('installed_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Total pack size from the manifest (null for bundled/local imports, T07). */
  bytes: integer('bytes'),
});

/**
 * Local analytics event log (workspace requirement: exceptional analytics
 * even though single-user). Written by `src/services/analytics.ts` track();
 * queried by the dashboard/progress engine later.
 */
export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    event: text('event').notNull(),
    props: text('props', { mode: 'json' }).$type<Record<string, string | number | boolean>>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('analytics_events_event_idx').on(t.event, t.createdAt)],
);
