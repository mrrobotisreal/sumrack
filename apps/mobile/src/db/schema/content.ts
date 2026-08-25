import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Content tables — the denormalized form of a validated `Pack` from
 * `@sumrak/schema` (design §4.3/§5). Rebuilt wholesale by the importer:
 * every row carries `packId`, and reimporting/removing a pack deletes all
 * rows for that pack id (FK cascade from `packs`). Content is disposable;
 * user tables (see ./user.ts) never live here and never reference these
 * with enforced FKs — user refs are plain stable-id strings that must
 * survive content replacement.
 */

export const packs = sqliteTable('packs', {
  /** Stable pack id, e.g. "a1-creepypasta-001". */
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  // 'dialogue' joined the pack types in T25 (type-level only — dialogue
  // content tables + importer support land in T26).
  type: text('type')
    .$type<'stories' | 'course-unit' | 'checkpoint' | 'prompts' | 'dialogue'>()
    .notNull(),
  titleRu: text('title_ru').notNull(),
  titleEn: text('title_en').notNull(),
  level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>().notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  importedAt: integer('imported_at').notNull(),
});

export const stories = sqliteTable(
  'stories',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    /** Stable story id, unique within its pack. */
    id: text('id').notNull(),
    orderIdx: integer('order_idx').notNull(),
    titleRu: text('title_ru').notNull(),
    titleEn: text('title_en').notNull(),
    level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] }), index('stories_id_idx').on(t.id)],
);

export const sentences = sqliteTable(
  'sentences',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    /** Stable sentence id, unique pack-wide (user data references it). */
    id: text('id').notNull(),
    storyId: text('story_id').notNull(),
    /** Position within the story, reading order. */
    orderIdx: integer('order_idx').notNull(),
    ru: text('ru').notNull(),
    en: text('en').notNull(),
    grammarTopics: text('grammar_topics', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.id] }),
    index('sentences_story_idx').on(t.packId, t.storyId, t.orderIdx),
    index('sentences_id_idx').on(t.id),
  ],
);

export const tokens = sqliteTable(
  'tokens',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    sentenceId: text('sentence_id').notNull(),
    /** 0-based position in the sentence's token array. */
    tokenIndex: integer('token_index').notNull(),
    /** Denormalized for story-scoped queries (cloze generation etc.). */
    storyId: text('story_id').notNull(),
    /** Surface form exactly as authored (NFC, ё preserved). */
    text: text('text').notNull(),
    /** ё/е-folded, lowercased shadow of `text` for tolerant matching. */
    textNorm: text('text_norm').notNull(),
    isPunct: integer('is_punct', { mode: 'boolean' }).notNull().default(false),
    /** Effective space-before after applying schema defaults (reader reconstruction). */
    spaceBefore: integer('space_before', { mode: 'boolean' }).notNull(),
    lemma: text('lemma'),
    /** ё/е-folded, lowercased shadow of `lemma`. */
    lemmaNorm: text('lemma_norm'),
    translation: text('translation'),
    pos: text('pos'),
    grammar: text('grammar'),
    level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>(),
    note: text('note'),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.sentenceId, t.tokenIndex] }),
    index('tokens_lemma_norm_idx').on(t.lemmaNorm),
    // T22 perf: story-scoped reader load (getStoryDetail fires on every
    // story open; story_id was denormalized for exactly this but never
    // indexed — mirrors sentences_story_idx).
    index('tokens_story_idx').on(t.packId, t.storyId, t.tokenIndex),
    // T22 perf: dashboard vocab-by-level CTE (GROUP BY lemma_norm with
    // level, filtered to annotated word tokens) — covering partial index.
    index('tokens_level_lemma_idx')
      .on(t.lemmaNorm, t.level)
      .where(sql`is_punct = 0 AND lemma_norm IS NOT NULL AND level IS NOT NULL`),
  ],
);

export const audioTracks = sqliteTable(
  'audio_tracks',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    storyId: text('story_id').notNull(),
    /** Stable track id, unique within its story. */
    id: text('id').notNull(),
    voice: text('voice').notNull(),
    style: text('style').notNull(),
    /** Pack-relative path as authored, e.g. "audio/story1-voice1.opus". */
    file: text('file').notNull(),
    /** Absolute local URI once the audio file landed in app storage (null until then). */
    localUri: text('local_uri'),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.storyId, t.id] })],
);

export const wordStamps = sqliteTable(
  'word_stamps',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    storyId: text('story_id').notNull(),
    trackId: text('track_id').notNull(),
    /** Position in the track's timestamps array. */
    stampIndex: integer('stamp_index').notNull(),
    sentenceId: text('sentence_id').notNull(),
    tokenIndex: integer('token_index').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.storyId, t.trackId, t.stampIndex] }),
    index('word_stamps_time_idx').on(t.packId, t.storyId, t.trackId, t.startMs),
  ],
);

export const lessons = sqliteTable(
  'lessons',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    titleRu: text('title_ru').notNull(),
    titleEn: text('title_en').notNull(),
    /** Markdown lesson body. */
    body: text('body').notNull(),
    grammarTopics: text('grammar_topics', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] })],
);

export const journalPrompts = sqliteTable(
  'journal_prompts',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>().notNull(),
    promptRu: text('prompt_ru').notNull(),
    promptEn: text('prompt_en').notNull(),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] })],
);

export const exerciseSpecs = sqliteTable(
  'exercise_specs',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    kind: text('kind').notNull(),
    orderIdx: integer('order_idx').notNull(),
    /**
     * The full ExerciseSpec object as validated JSON. Kinds are a growing
     * union (T13/T14/T17 extend additively) — storing the whole spec keeps
     * this table migration-free as kinds gain fields.
     */
    spec: text('spec', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] })],
);
