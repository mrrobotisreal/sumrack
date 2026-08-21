import { z } from 'zod';
import {
  CefrLevelSchema,
  LocalizedTextSchema,
  PackTypeSchema,
  RelativePathSchema,
  StableIdSchema,
} from './common';

/**
 * One surface word (or punctuation mark) of a sentence (design §4.2 `Token`).
 *
 * Punctuation-flag decision (T02): punctuation is its own token with
 * `isPunct: true`, and punctuation tokens must not carry linguistic
 * annotations (lemma/translation/pos/grammar/level). Word tokens leave
 * `isPunct` unset. This keeps `tokens` a faithful, ordered decomposition of
 * the sentence — `reconstructSentenceRu(tokens)` must reproduce
 * `Sentence.ru` exactly, which the Sentence schema enforces.
 */
export const TokenSchema = z
  .strictObject({
    /** Surface form exactly as it appears in the sentence (NFC, ё preserved). */
    text: z.string().min(1),
    /**
     * Punctuation flag: `true` marks this token as punctuation («, », —, ., …).
     * Punctuation tokens carry no linguistic annotations. Absent = word token.
     */
    isPunct: z.boolean().optional(),
    /**
     * Whether a single space precedes this token when reconstructing the
     * sentence. Defaults: `false` for the first token and for punctuation,
     * `true` for word tokens. Override for cases like an opening « (space
     * before it: `true`) and the word right after it (`false`).
     */
    spaceBefore: z.boolean().optional(),
    /** Dictionary form (absent for punctuation and some proper names). */
    lemma: z.string().min(1).optional(),
    /** Context-appropriate English gloss of this occurrence. */
    translation: z.string().min(1).optional(),
    /** Part of speech: noun/verb/adj/adv/pron/prep/conj/part/num/name/... */
    pos: z.string().min(1).optional(),
    /** Compact grammar notes: "gen.pl.", "pf. of говорить", "1sg. pres.", ... */
    grammar: z.string().min(1).optional(),
    /** CEFR tag of the LEMMA (not the surface form) — drives the progress model. */
    level: CefrLevelSchema.optional(),
    /** Idiom or culture note, shown in the word popup when present. */
    note: z.string().min(1).optional(),
  })
  .superRefine((tok, ctx) => {
    if (tok.text !== tok.text.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'token text must be UTF-8 NFC-normalized',
      });
    }
    if (tok.isPunct) {
      for (const field of ['lemma', 'translation', 'pos', 'grammar', 'level'] as const) {
        if (tok[field] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `punctuation token "${tok.text}" must not carry "${field}"`,
          });
        }
      }
    }
  });
export type Token = z.infer<typeof TokenSchema>;

/**
 * Rebuild the Russian sentence text from its tokens using the `spaceBefore`
 * defaults documented on {@link TokenSchema}. The Sentence schema requires
 * this to equal `Sentence.ru` exactly, so token annotations can never drift
 * from the sentence they annotate.
 */
export function reconstructSentenceRu(tokens: readonly Token[]): string {
  let out = '';
  tokens.forEach((tok, i) => {
    const space = tok.spaceBefore ?? (i > 0 && !tok.isPunct);
    out += (space ? ' ' : '') + tok.text;
  });
  return out;
}

/**
 * One sentence of a story (design §4.2 `Sentence`): the Russian text, its
 * natural English translation (for the reader's reveal), and its tokens.
 */
export const SentenceSchema = z
  .strictObject({
    /** Stable id, unique across the whole pack (user data references it). */
    id: StableIdSchema,
    /** Full sentence text, Russian, NFC, ё preserved. */
    ru: z.string().min(1),
    /** Natural English translation (for the sentence-reveal toggle). */
    en: z.string().min(1),
    /** Ordered decomposition of `ru` — words and punctuation. */
    tokens: z.array(TokenSchema).min(1),
    /** Grammar topics exercised: "past-tense", "genitive-plural", ... Feeds grammar coverage. */
    grammarTopics: z.array(z.string().min(1)).optional(),
  })
  .superRefine((sentence, ctx) => {
    if (sentence.ru !== sentence.ru.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ru'],
        message: 'sentence text must be UTF-8 NFC-normalized',
      });
    }
    const rebuilt = reconstructSentenceRu(sentence.tokens);
    if (rebuilt !== sentence.ru) {
      ctx.addIssue({
        code: 'custom',
        path: ['tokens'],
        message: `tokens do not reconstruct the sentence: expected "${sentence.ru}", got "${rebuilt}"`,
      });
    }
  });
export type Sentence = z.infer<typeof SentenceSchema>;

/**
 * A word-level timestamp on an audio track (design §4.2 `WordStamp`), driving
 * karaoke highlighting: token `tokenIndex` of sentence `sentenceId` is being
 * spoken during [startMs, endMs). Kept deliberately tolerant — no cross-stamp
 * monotonicity is enforced by schema (alignment quality is a pipeline
 * concern, and karaoke degrades gracefully on imperfect stamps).
 */
export const WordStampSchema = z
  .strictObject({
    /** Id of the sentence this stamp points into (must exist in the story). */
    sentenceId: StableIdSchema,
    /** Index into that sentence's `tokens` array (0-based). */
    tokenIndex: z.number().int().nonnegative(),
    /** Start of the word in the audio, milliseconds. */
    startMs: z.number().int().nonnegative(),
    /** End of the word in the audio, milliseconds; must be > startMs. */
    endMs: z.number().int().nonnegative(),
  })
  .refine((s) => s.endMs > s.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });
export type WordStamp = z.infer<typeof WordStampSchema>;

/**
 * One narration rendition of a story in a specific voice and emotional style
 * (design §4.2 `AudioTrack`), shipped as an Opus file in the pack.
 */
export const AudioTrackSchema = z.strictObject({
  /** Stable id, unique within the story. */
  id: StableIdSchema,
  /** Provider-prefixed voice id, e.g. "elevenlabs:Anton". */
  voice: z
    .string()
    .regex(/^[a-z0-9-]+:.+$/, 'voice is provider-prefixed, e.g. "elevenlabs:<voice-name>"'),
  /** Emotional/delivery style: "creepy-whisper", "neutral", "energetic", ... */
  style: z.string().min(1),
  /** Audio file path relative to the pack dir, e.g. "audio/story1-voice1.opus". */
  file: RelativePathSchema,
  /** Total duration of the audio file in milliseconds. */
  durationMs: z.number().int().positive(),
  /**
   * Word-level karaoke timestamps. May be empty: karaoke then degrades to
   * sentence-level highlighting (design §11).
   */
  timestamps: z.array(WordStampSchema),
});
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

/**
 * A single readable text (story, article, or dialogue) inside a pack
 * (design §4.2 `Story`), composed of sentences.
 */
export const StorySchema = z.strictObject({
  /** Stable id, unique within the pack. */
  id: StableIdSchema,
  /** Bilingual story title. */
  title: LocalizedTextSchema,
  /** CEFR level of this story (may differ from siblings in the same pack). */
  level: CefrLevelSchema,
  /** The story text, sentence by sentence, in reading order. */
  sentences: z.array(SentenceSchema).min(1),
  /** 0..n narration renditions (different voices/styles). Empty = no narration yet. */
  audio: z.array(AudioTrackSchema),
});
export type Story = z.infer<typeof StorySchema>;

/**
 * A markdown grammar mini-lesson carried by a course-unit pack (design §4.1).
 * Shape pinned in T02 (design leaves it loose): id + bilingual title +
 * markdown body + the grammar topics it teaches.
 */
export const LessonSchema = z.strictObject({
  /** Stable id, unique within the pack. */
  id: StableIdSchema,
  /** Bilingual lesson title. */
  title: LocalizedTextSchema,
  /** Lesson content as markdown (Russian examples inline, English explanations). */
  body: z.string().min(1),
  /** Grammar topics this lesson covers — same vocabulary as `Sentence.grammarTopics`. */
  grammarTopics: z.array(z.string().min(1)).optional(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * An authored exercise (checkpoints mainly, unit quizzes later). Shape pinned
 * provisionally in T02 as a discriminated union on `kind` so T13/T14/T17 can
 * extend it additively; kinds mirror the game modes that make sense authored.
 * All refinement checks live in the union's superRefine (see below).
 */
const MultipleChoiceSpec = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('multiple-choice'),
  /** Translation direction being tested. */
  direction: z.enum(['ru-en', 'en-ru']),
  /** The prompt shown (a RU or EN word/sentence per `direction`). */
  prompt: z.string().min(1),
  /** Answer choices; 2–6 of them. */
  choices: z.array(z.string().min(1)).min(2).max(6),
  /** Index of the correct choice (0-based, < choices.length). */
  correctIndex: z.number().int().nonnegative(),
});

const ClozeSpec = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('cloze'),
  /** Russian sentence with the blank marked as "___". */
  sentenceRu: z.string().min(1),
  /** The word that fills the blank. */
  answer: z.string().min(1),
  /** Optional tile choices (tile-pick variant); typed variant when absent. */
  choices: z.array(z.string().min(1)).min(2).optional(),
});

const SentenceBuilderSpec = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('sentence-builder'),
  /** English sentence given as the prompt. */
  en: z.string().min(1),
  /** Correct Russian tiles in order. */
  tokens: z.array(z.string().min(1)).min(2),
  /** Extra wrong tiles mixed in at higher levels. */
  distractors: z.array(z.string().min(1)).optional(),
});

const ListeningSpec = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('listening'),
  /** Russian text to synthesize/play; the learner picks or types what they heard. */
  text: z.string().min(1),
  /** Optional pick-from choices; typed variant when absent. */
  choices: z.array(z.string().min(1)).min(2).optional(),
});

const PronunciationSpec = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('pronunciation'),
  /** Russian phrase the learner must say aloud (scored by ASR alignment). */
  text: z.string().min(1),
});

export const ExerciseSpecSchema = z
  .discriminatedUnion('kind', [
    MultipleChoiceSpec,
    ClozeSpec,
    SentenceBuilderSpec,
    ListeningSpec,
    PronunciationSpec,
  ])
  .superRefine((spec, ctx) => {
    if (spec.kind === 'multiple-choice' && spec.correctIndex >= spec.choices.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctIndex'],
        message: `correctIndex ${spec.correctIndex} is out of range for ${spec.choices.length} choices`,
      });
    }
    if (spec.kind === 'cloze' && !spec.sentenceRu.includes('___')) {
      ctx.addIssue({
        code: 'custom',
        path: ['sentenceRu'],
        message: 'cloze sentence must contain the blank marker "___"',
      });
    }
    if (spec.kind === 'cloze' && spec.choices && !spec.choices.includes(spec.answer)) {
      ctx.addIssue({
        code: 'custom',
        path: ['choices'],
        message: 'cloze choices must include the answer',
      });
    }
  });
export type ExerciseSpec = z.infer<typeof ExerciseSpecSchema>;

/**
 * A level-tagged writing prompt shipped in packs and surfaced daily in the
 * journal (design §4.1 `prompts`).
 */
export const JournalPromptSchema = z.strictObject({
  /** Stable id, unique within the pack. */
  id: StableIdSchema,
  /** CEFR level this prompt suits. */
  level: CefrLevelSchema,
  /** The prompt itself: ru is what's shown to write about; en clarifies. */
  prompt: LocalizedTextSchema,
  /** Free-form tags ("daily-life", "horror", ...). */
  tags: z.array(z.string().min(1)).optional(),
});
export type JournalPrompt = z.infer<typeof JournalPromptSchema>;

/**
 * The content pack (design §4.2 `Pack`) — the unit of authoring, sync, and
 * versioning. Everything the app knows about Russian arrives in a pack.
 *
 * Cross-cutting invariants enforced here:
 * - story ids unique within the pack; sentence ids unique across the pack
 *   (user data references sentence ids pack-wide);
 * - every WordStamp resolves to a real sentence + token index in its story,
 *   and ends within the track duration;
 * - pack `type` implies required sections (stories / lesson / exercises / prompts).
 */
export const PackSchema = z
  .strictObject({
    /** Stable pack id, e.g. "a1-creepypasta-001". Never renumbered. */
    id: StableIdSchema,
    /** Integer version; bump to update. The app migrates user refs by stable ids. */
    version: z.number().int().min(1),
    /** What kind of pack this is — see PackTypeSchema. */
    type: PackTypeSchema,
    /** Bilingual pack title. */
    title: LocalizedTextSchema,
    /** Overall CEFR level of the pack. */
    level: CefrLevelSchema,
    /** Free-form tags: "creepypasta", "dialogue", "grammar:genitive", ... */
    tags: z.array(z.string().min(1)),
    /** The pack's stories. May be empty only for non-`stories` pack types. */
    stories: z.array(StorySchema),
    /** Markdown grammar mini-lesson (course-unit packs). */
    lesson: LessonSchema.optional(),
    /** Authored exercise overrides (checkpoints mainly). */
    exercises: z.array(ExerciseSpecSchema).optional(),
    /** Journal prompts (prompts packs, or riding along in course units). */
    prompts: z.array(JournalPromptSchema).optional(),
  })
  .superRefine((pack, ctx) => {
    // type → required sections
    if (pack.type === 'stories' && pack.stories.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['stories'],
        message: 'a "stories" pack must contain at least one story',
      });
    }
    if (pack.type === 'course-unit') {
      if (!pack.lesson) {
        ctx.addIssue({
          code: 'custom',
          path: ['lesson'],
          message: 'a "course-unit" pack must include a lesson',
        });
      }
      if (pack.stories.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['stories'],
          message: 'a "course-unit" pack must reference at least one story',
        });
      }
    }
    if (pack.type === 'checkpoint' && (pack.exercises?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exercises'],
        message: 'a "checkpoint" pack must contain at least one exercise',
      });
    }
    if (pack.type === 'prompts' && (pack.prompts?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompts'],
        message: 'a "prompts" pack must contain at least one journal prompt',
      });
    }

    // id uniqueness
    const storyIds = new Set<string>();
    pack.stories.forEach((story, si) => {
      if (storyIds.has(story.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stories', si, 'id'],
          message: `duplicate story id "${story.id}"`,
        });
      }
      storyIds.add(story.id);
    });
    const sentenceIds = new Map<string, Sentence>();
    pack.stories.forEach((story, si) => {
      story.sentences.forEach((sentence, qi) => {
        if (sentenceIds.has(sentence.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['stories', si, 'sentences', qi, 'id'],
            message: `duplicate sentence id "${sentence.id}" (sentence ids are unique pack-wide)`,
          });
        }
        sentenceIds.set(sentence.id, sentence);
      });
    });

    // word stamps resolve
    pack.stories.forEach((story, si) => {
      const byId = new Map(story.sentences.map((s) => [s.id, s]));
      story.audio.forEach((track, ti) => {
        track.timestamps.forEach((stamp, wi) => {
          const path = ['stories', si, 'audio', ti, 'timestamps', wi];
          const sentence = byId.get(stamp.sentenceId);
          if (!sentence) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'sentenceId'],
              message: `word stamp references unknown sentence "${stamp.sentenceId}" in story "${story.id}"`,
            });
            return;
          }
          if (stamp.tokenIndex >= sentence.tokens.length) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'tokenIndex'],
              message: `tokenIndex ${stamp.tokenIndex} is out of range for sentence "${stamp.sentenceId}" (${sentence.tokens.length} tokens)`,
            });
          }
          if (stamp.endMs > track.durationMs) {
            ctx.addIssue({
              code: 'custom',
              path: [...path, 'endMs'],
              message: `word stamp ends at ${stamp.endMs}ms, past the track duration ${track.durationMs}ms`,
            });
          }
        });
      });
    });
  });
export type Pack = z.infer<typeof PackSchema>;
