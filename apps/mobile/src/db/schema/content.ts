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
  /**
   * Where the pack came from (T28, design V2 §4.3): 'remote' = manifest-
   * managed (github sync AND bundled fixtures — both version-diff against
   * the manifest), 'local' = assembled on-device from a Share-to-Сумрак
   * import. Local packs are invisible to sync (immunity keyed on the
   * sync_state 'local-import' source, set alongside this by the imports
   * service) and are listed on the Library's «Импортировано» shelf.
   */
  origin: text('origin').$type<'remote' | 'local'>().notNull().default('remote'),
  /**
   * Ambient room theme (T30, V2 §5.2): scene id from `pack.theme.scene`
   * (plain string — the APP holds the known house set; unknown scenes fall
   * back to the default path presentation) + optional '#RRGGBB' accent.
   * NULL = unthemed. Read for course-unit packs by the house map (T30) and
   * the ambient scenes (T31).
   */
  themeScene: text('theme_scene'),
  themeAccent: text('theme_accent'),
  /**
   * Path track (T30, V2 §6.1), e.g. 'family'. NULL = authored without a
   * track = the main track — the 'main' default lives at the app layer
   * (path-model), keeping the row an honest mirror of the pack JSON.
   */
  track: text('track'),
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

/**
 * A dialogue's cast, stored as JSON on the `dialogues` row (T26): small,
 * loaded whole with the graph, never queried per-character. Mirrors the
 * schema's Character shape.
 */
export interface DialogueCharacter {
  id: string;
  name: { ru: string; en: string };
  voice: string;
  style: string;
  audioTag?: string;
}

/**
 * Dialogue content tables (T26, design V2 §3.3). Denormalized from
 * `Pack.dialogues`; node/choice SENTENCES live in the shared
 * `sentences`/`tokens` tables with `storyId` = the dialogue id (they ARE
 * sentences — pack-wide unique ids make this safe, and story-scoped queries
 * all join `stories`/`story_progress`, which naturally excludes them).
 * User data (`dialogue_runs`, see ./user.ts) references dialogue/ending ids
 * as plain strings and survives reimport/removal.
 */
export const dialogues = sqliteTable(
  'dialogues',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    /** Stable dialogue id, unique within its pack. */
    id: text('id').notNull(),
    orderIdx: integer('order_idx').notNull(),
    titleRu: text('title_ru').notNull(),
    titleEn: text('title_en').notNull(),
    level: text('level').$type<'A1' | 'A2' | 'B1' | 'B2' | 'C1'>().notNull(),
    startNodeId: text('start_node_id').notNull(),
    characters: text('characters', { mode: 'json' }).$type<DialogueCharacter[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.id] }), index('dialogues_id_idx').on(t.id)],
);

export const dialogueNodes = sqliteTable(
  'dialogue_nodes',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    dialogueId: text('dialogue_id').notNull(),
    /** Stable node id, unique within its dialogue. */
    id: text('id').notNull(),
    /** Declaration order (branch-map/authoring order, not walk order). */
    orderIdx: integer('order_idx').notNull(),
    speakerId: text('speaker_id').notNull(),
    /** The node's line — resolves in `sentences` (storyId = dialogueId). */
    sentenceId: text('sentence_id').notNull(),
    /**
     * The T25 exactly-one-of discriminant: how the story continues here.
     * 'choices' → rows in dialogue_choices; 'next' → nextNodeId; 'ending' →
     * endingId.
     */
    kind: text('kind').$type<'choices' | 'next' | 'ending'>().notNull(),
    nextNodeId: text('next_node_id'),
    endingId: text('ending_id'),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.dialogueId, t.id] }),
    index('dialogue_nodes_dialogue_idx').on(t.packId, t.dialogueId, t.orderIdx),
  ],
);

export const dialogueChoices = sqliteTable(
  'dialogue_choices',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    dialogueId: text('dialogue_id').notNull(),
    /** The node this choice answers. */
    nodeId: text('node_id').notNull(),
    /** Stable choice id, unique within its node. */
    id: text('id').notNull(),
    /** Position among the node's choices (render order). */
    orderIdx: integer('order_idx').notNull(),
    /** The player's utterance — resolves in `sentences` (storyId = dialogueId). */
    sentenceId: text('sentence_id').notNull(),
    /** Node the story branches to when this choice is taken. */
    nextNodeId: text('next_node_id').notNull(),
    /** Alternate phrasings the ASR matcher also accepts. */
    asrAlternates: text('asr_alternates', { mode: 'json' }).$type<string[]>(),
    hintRu: text('hint_ru'),
    hintEn: text('hint_en'),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.dialogueId, t.nodeId, t.id] }),
    index('dialogue_choices_node_idx').on(t.packId, t.dialogueId, t.nodeId, t.orderIdx),
  ],
);

export const dialogueEndings = sqliteTable(
  'dialogue_endings',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    dialogueId: text('dialogue_id').notNull(),
    /** Stable ending id, unique within its dialogue. */
    id: text('id').notNull(),
    titleRu: text('title_ru').notNull(),
    titleEn: text('title_en').notNull(),
    recapRu: text('recap_ru').notNull(),
    recapEn: text('recap_en').notNull(),
    tone: text('tone').$type<'good' | 'bad' | 'strange'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.dialogueId, t.id] })],
);

/**
 * Per-node (and per-choice coach) dialogue audio — the T26 node-audio table
 * decision: a table PARALLEL to `audio_tracks`, keyed by SENTENCE id (every
 * audio file maps 1:1 to a node or choice sentence, and sentence ids are
 * unique pack-wide). Reusing `audio_tracks` would force fake storyId/trackId
 * keys and voice/style duplication (characters own those), and would leak
 * dialogue rows into story-audio queries. T27's per-line karaoke query is:
 * node → sentenceId → one audio row here + its stamps below.
 */
export const dialogueNodeAudio = sqliteTable(
  'dialogue_node_audio',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    dialogueId: text('dialogue_id').notNull(),
    nodeId: text('node_id').notNull(),
    /** Null = the node's own line; set = coach audio for that choice. */
    choiceId: text('choice_id'),
    sentenceId: text('sentence_id').notNull(),
    /** Pack-relative path, e.g. "audio/dinner-mini/din-n01.opus". */
    file: text('file').notNull(),
    /** Absolute local URI once staged in app storage (null until then). */
    localUri: text('local_uri'),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.sentenceId] }),
    index('dialogue_node_audio_dialogue_idx').on(t.packId, t.dialogueId),
  ],
);

/** Word stamps for dialogue audio; sentenceId keys straight into the audio row. */
export const dialogueNodeStamps = sqliteTable(
  'dialogue_node_stamps',
  {
    packId: text('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'cascade' }),
    sentenceId: text('sentence_id').notNull(),
    /** Position in the audio's timestamps array. */
    stampIndex: integer('stamp_index').notNull(),
    tokenIndex: integer('token_index').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.sentenceId, t.stampIndex] })],
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
