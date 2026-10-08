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
/** Which activity produced a grade (T50). NULL = pre-T50 row (unattributable). */
export type ReviewSource =
  | 'flashcard'
  | 'mc'
  | 'cloze'
  | 'sentence-builder'
  | 'listening'
  | 'pronunciation'
  | 'dialogue'
  | 'scenario';

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
    /**
     * Which activity produced the grade (T50, WORD_FORMS §2.1). Nullable, no
     * default: NULL = pre-T50 row (unattributable) — familiarity counts those
     * best-effort (decision 4). Every grading site passes its mode.
     */
    source: text('source').$type<ReviewSource>(),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId, t.reviewedAt),
    // T50: the familiarity subqueries filter on (card, source, time).
    index('review_log_source_idx').on(t.cardId, t.source, t.reviewedAt),
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

/**
 * Dialogue runs (T26, design V2 §3.3) — one row per playthrough of a
 * dialogue. `dialogueId`/`endingId` are unenforced content refs (T05
 * null-safe pattern: old runs still resolve after pack removal/update).
 * `pathJson`'s shape is owned by the dialogues repository's Zod schema
 * (`DialogueRunPathSchema`): `{ v: 1, steps: [{ nodeId, choiceId?, score? }] }`
 * — ordered visited nodes, the chosen choice at choice points, and the
 * per-choice ASR score when the answer was spoken.
 */
export const dialogueRuns = sqliteTable(
  'dialogue_runs',
  {
    id: text('id').primaryKey(),
    dialogueId: text('dialogue_id').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    endingId: text('ending_id'),
    pathJson: text('path_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /** Mean ASR score across the run's spoken choices (null: none spoken). */
    spokenScoreAvg: real('spoken_score_avg'),
  },
  (t) => [index('dialogue_runs_dialogue_idx').on(t.dialogueId, t.startedAt)],
);

/** Endings collected per dialogue (T26) — mini-achievement state for T27. */
export const dialogueEndingsSeen = sqliteTable(
  'dialogue_endings_seen',
  {
    dialogueId: text('dialogue_id').notNull(),
    endingId: text('ending_id').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.dialogueId, t.endingId] })],
);

export type ImportRequestStatus = 'draft' | 'queued' | 'annotated' | 'committed' | 'failed';

/**
 * Share-to-Сумрак import requests (T28, design V2 §4.1) — the durable
 * intake record, T15/T16's `feedbackStatus` pattern as its own table: a
 * `'queued'` row IS a pending annotation request that survives restarts
 * (annotation is online-only in T29; intake must not be). Status walk:
 * `draft` (reserved for T29's edit-in-review) → `queued` (intake saved,
 * awaiting annotation) → `annotated` (T29: `annotationJson` holds the
 * pack-shaped proposal awaiting review) → `committed` (`packId` set, the
 * pack is live). `failed` + `error` record an annotation failure; retry
 * re-queues. T28 ships intake + the dev-only stub path (queued → committed
 * directly); T29 owns the middle without re-migrating.
 */
export const importRequests = sqliteTable(
  'import_requests',
  {
    id: text('id').primaryKey(),
    /** The shared/pasted text, NFC-normalized at intake (untrusted input). */
    text: text('text').notNull(),
    title: text('title').notNull(),
    sourceLabel: text('source_label'),
    status: text('status').$type<ImportRequestStatus>().notNull(),
    /** T29: the annotated pack proposal (JSON string) awaiting review. */
    annotationJson: text('annotation_json'),
    /** T29: last annotation failure message (cleared on retry). */
    error: text('error'),
    /** Set on commit: the local pack this request became. */
    packId: text('pack_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('import_requests_status_idx').on(t.status, t.createdAt)],
);

/**
 * Committed local packs, by value (T28, design V2 §4.3): the schema-valid
 * pack JSON gzipped+base64 in a USER table, because content tables are
 * never backed up — this row is what makes an imported pack survive
 * backup/restore (restore re-imports every row automatically). `id` IS the
 * pack id (`imported-<yyyymmdd>-<slug>`). Deleting an imported pack deletes
 * this row too (remove = full delete, recorded T28 decision).
 */
export const importedPacks = sqliteTable('imported_packs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceLabel: text('source_label'),
  /** Gzipped (fflate), base64-encoded pack JSON — text not blob so the row
   * round-trips the JSON backup payload without a binary side-channel. */
  packJsonGz: text('pack_json_gz').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type ProfileKind = 'word' | 'phrase';
/**
 * The AI run profile enums (M16, WORD_FORMS §2.2 / §4.1). Defined HERE —
 * the one definition — because the schema cannot import from features/;
 * `features/ai/run-profile.ts` re-exports them.
 */
export type AiProvider = 'anthropic' | 'openai';
export type AiQuality = 'fastest' | 'fast' | 'normal' | 'best';
export type AiEffort = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Word profiles (T52, WORD_FORMS §2.2, ADR-0018): the persisted, versioned,
 * AI-generated grammar dossier of one lemma or phrase. Keyed by the bank
 * dedup key `(lemma_norm, kind)` — NOT by bank row — so a profile survives
 * item deletion and re-adding (decision 10: old versions kept, exactly one
 * current per key, promotable). User data: backed up, never in content.
 */
export const wordProfiles = sqliteTable(
  'word_profiles',
  {
    id: text('id').primaryKey(),
    /** Profile key — the bank dedup key: normalizeRu(lemma) for words, normalizePhrase(surface) for phrases. */
    lemmaNorm: text('lemma_norm').notNull(),
    kind: text('kind').$type<ProfileKind>().notNull(),
    /** Headword as stored on the bank item at generation time (ё preserved, no stress marks). */
    headword: text('headword').notNull(),
    /** Model-classified part of speech (catalog slug) — informational, not part of the key. */
    pos: text('pos').notNull(),
    /** Exactly one current version per (lemma_norm, kind). */
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    /** WordProfile JSON (schema §5) — Zod-parsed on read; unreadable → treated as absent, never a crash. */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    provider: text('provider').$type<AiProvider>().notNull(),
    model: text('model').notNull(),
    quality: text('quality').$type<AiQuality>().notNull(),
    effort: text('effort').$type<AiEffort>().notNull(),
    /** true when the effort param was accepted; false when the client had to retry without it (§4.4). */
    effortApplied: integer('effort_applied', { mode: 'boolean' }).notNull().default(true),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    costUsd: real('cost_usd'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('word_profiles_key_idx').on(t.lemmaNorm, t.kind, t.createdAt),
    uniqueIndex('word_profiles_current_uq')
      .on(t.lemmaNorm, t.kind)
      .where(sql`is_current = 1`),
  ],
);

/**
 * Grammar lessons (T54, WORD_FORMS §2.3; the table ships in T52's migration
 * so T54 needs none): append-only saved AI markdown about one word × one
 * catalog section, with its receipt. `profileId` is an unenforced ref.
 */
export const grammarLessons = sqliteTable(
  'grammar_lessons',
  {
    id: text('id').primaryKey(),
    lemmaNorm: text('lemma_norm').notNull(),
    kind: text('kind').$type<ProfileKind>().notNull(),
    headword: text('headword').notNull(),
    /** Section catalog id (§5.3) the lesson is about. */
    sectionId: text('section_id').notNull(),
    /** The profile version the lesson was generated from (unenforced ref — a promoted/older version may be gone). */
    profileId: text('profile_id'),
    /** Lesson markdown (bounded, §6.2). */
    markdown: text('markdown').notNull(),
    provider: text('provider').$type<AiProvider>().notNull(),
    model: text('model').notNull(),
    quality: text('quality').$type<AiQuality>().notNull(),
    effort: text('effort').$type<AiEffort>().notNull(),
    effortApplied: integer('effort_applied', { mode: 'boolean' }).notNull().default(true),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    costUsd: real('cost_usd'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('grammar_lessons_key_idx').on(t.lemmaNorm, t.kind, t.sectionId, t.createdAt),
    index('grammar_lessons_created_idx').on(t.createdAt),
  ],
);

/**
 * Scenario runs (T58, SPEAKING_SCENARIOS §4.2 — verbatim) — one row per
 * playthrough of a scenario. `packId`/`scenarioId`/`endingId` are
 * unenforced content refs (old runs still resolve after pack removal /
 * update). `pathJson`'s shape is owned by the scenarios repo's Zod schema
 * (`ScenarioRunPathSchema`) and is replayable like T27 (resume-in-place).
 */
export const scenarioRuns = sqliteTable(
  'scenario_runs',
  {
    id: text('id').primaryKey(),
    packId: text('pack_id').notNull(),
    scenarioId: text('scenario_id').notNull(),
    familyId: text('family_id').notNull(),
    level: text('level').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    endingId: text('ending_id'),
    /** { v:1, steps:[{ turnId, branchKey?, misses, assisted, skipped, rescued, meta: number }] } — Zod-parsed on read; replayable like T27 (resume-in-place). */
    pathJson: text('path_json').notNull(),
    /** { turns, cleanTurns, misses, lifelines, skips, metaAsks, rescues, avgScore } — written at finish. */
    statsJson: text('stats_json'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** Local recordings present? Pruning flips this; the debrief offers a bundle download when false. */
    mediaLocal: integer('media_local', { mode: 'boolean' }).notNull().default(true),
    /** null = not bundled yet · 'pending' · 'uploaded' · 'failed' — per §10. */
    mediaBundleState: text('media_bundle_state'),
    mediaBundleName: text('media_bundle_name'),
    gameSessionId: text('game_session_id'),
  },
  (t) => [
    index('scenario_runs_scenario_idx').on(t.scenarioId, t.startedAt),
    index('scenario_runs_finished_idx').on(t.finishedAt),
  ],
);

/** One spoken attempt (answer or meta-intent) inside a run (§4.2 verbatim); cascades with its run. */
export const scenarioAttempts = sqliteTable(
  'scenario_attempts',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => scenarioRuns.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    kind: text('kind').$type<'answer' | 'meta'>().notNull(),
    /** answer: 'matched' | 'rescued' | 'miss' | 'skipped' · meta: 'explain' | 'howtosay' | 'repeat' | 'slower' | 'dont-understand' | 'unknown' */
    outcome: text('outcome').notNull(),
    transcript: text('transcript').notNull(),
    /** answer: { target, words:[{display,target,heard,matched}], score, slots:{[id]: key|null} } · meta: { query, hit: entryId|null, source: 'glossary'|'whisper'|'online'|'none' } */
    detailJson: text('detail_json').notNull(),
    /** Relative to the recordings root; null once pruned. */
    audioFile: text('audio_file'),
    audioDurationMs: integer('audio_duration_ms'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('scenario_attempts_run_idx').on(t.runId, t.turnId, t.attemptNo)],
);

/**
 * Exam attempts (T68, TORFL_EXAM_PREP §4.2) — one sitting of an exam: a full
 * mock, one subtest, or a drill session. `packId`/`examId` are unenforced
 * content refs (attempts outlive pack versions, §12). The JSON columns are
 * contracts owned by `features/torfl/model.ts` and Zod-parsed on read by the
 * exams repo. Only one `active` attempt exists at a time (repo rule).
 */
export const examAttempts = sqliteTable(
  'exam_attempts',
  {
    id: text('id').primaryKey(),
    packId: text('pack_id').notNull(),
    examId: text('exam_id').notNull(),
    /** 'full' | 'subtest' | 'drill' */
    scope: text('scope').$type<'full' | 'subtest' | 'drill'>().notNull(),
    /** JSON string[] — the subtests this attempt covers, in order. */
    subtestIds: text('subtest_ids').notNull(),
    /** 'mock' | 'drill' (copied from the exam at start). */
    mode: text('mode').$type<'mock' | 'drill'>().notNull(),
    status: text('status').$type<'active' | 'finished' | 'abandoned'>().notNull(),
    /** Engine state for resume (`ExamAttemptState`): cursor, wall-clock deadlines, play counters, speaking phase. */
    stateJson: text('state_json').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    /** `{ [subtestId]: ExamSubtestResult }` — written at finish (and upgraded by AI grading). */
    resultsJson: text('results_json'),
    /** 'pass' | 'pass-borderline' | 'fail' | null (non-full scopes). */
    verdict: text('verdict').$type<'pass' | 'pass-borderline' | 'fail'>(),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    /** Keeps recordings from pruning (§8.5). */
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('exam_attempts_status_idx').on(t.status, t.startedAt),
    index('exam_attempts_exam_idx').on(t.packId, t.examId, t.startedAt),
  ],
);

/** Grading lifecycle of one response (§4.2; the T72 queue keys on `pending-ai`). */
export type ExamGradingStatus =
  'scored' | 'provisional' | 'pending-ai' | 'ai-failed' | 'self-graded';

/**
 * One answered item inside an attempt (§4.2): every drill answer and every
 * scored mock item lands here, so history, per-topic accuracy and readiness
 * read from one table. Upserted on (attemptId, subtestId, itemId); cascades
 * with its attempt (the scenario_attempts precedent).
 */
export const examResponses = sqliteTable(
  'exam_responses',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => examAttempts.id, { onDelete: 'cascade' }),
    subtestId: text('subtest_id').notNull(),
    itemId: text('item_id').notNull(),
    /** `ExamAnswer` — choice {index} · typed {text} · writing {text} · speaking {transcript, …}. */
    answerJson: text('answer_json').notNull(),
    points: real('points'),
    maxPoints: real('max_points').notNull(),
    gradingStatus: text('grading_status').$type<ExamGradingStatus>().notNull(),
    /** `ExamGrading` — offline breakdown + AI rubric payload (§6.2), or NULL. */
    gradingJson: text('grading_json'),
    durationMs: integer('duration_ms'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('exam_responses_item_uq').on(t.attemptId, t.subtestId, t.itemId),
    index('exam_responses_grading_idx').on(t.gradingStatus),
  ],
);

/**
 * The exam deck («Работа над ошибками», §7.2) — FSRS state per exam item,
 * SEPARATE from `cards`/`review_log` (ADR-0020 decision 5: vocabulary stats
 * never see exam items). `fsrsJson` holds the ts-fsrs Card; `due` is
 * denormalized for the due query.
 */
export const examItemCards = sqliteTable(
  'exam_item_cards',
  {
    /** `${packId}:${examId}:${itemId}` */
    itemKey: text('item_key').primaryKey(),
    packId: text('pack_id').notNull(),
    examId: text('exam_id').notNull(),
    itemId: text('item_id').notNull(),
    subtestKind: text('subtest_kind').notNull(),
    topic: text('topic').notNull(),
    fsrsJson: text('fsrs_json').notNull(),
    due: integer('due').notNull(),
    /** 'correct' | 'wrong' — the last grade's outcome (NULL until first graded). */
    lastResult: text('last_result').$type<'correct' | 'wrong'>(),
    suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('exam_item_cards_due_idx').on(t.due),
    index('exam_item_cards_topic_idx').on(t.topic),
  ],
);

/**
 * Acknowledged leeches (T38). A card whose recent history trips the leech
 * rule (features/dashboard/leeches.ts) can be dismissed from the inbox; it
 * stays suppressed until it earns an `Again` reviewed AFTER `dismissedAt`
 * (re-dismissing overwrites the stamp). Cascades with its card.
 */
export const leechDismissals = sqliteTable('leech_dismissals', {
  cardId: text('card_id')
    .primaryKey()
    .references(() => cards.id, { onDelete: 'cascade' }),
  dismissedAt: integer('dismissed_at').notNull(),
});

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
