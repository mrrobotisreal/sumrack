import {
  CefrLevelSchema,
  LocalizedTextSchema,
  PackTypeSchema,
  StableIdSchema,
  StorySourceSchema,
} from '@sumrak/schema';
import { z } from 'zod';
import { REGISTER_SLUGS } from './registers.ts';

/**
 * Draft frontmatter (YAML between `---` fences at the top of a draft file).
 *
 * Every draft carries the full pack meta so a single file is self-contained;
 * multi-story packs are N draft files whose `pack` sections must be identical.
 * The `voice` section is the T09 audio contract (voice direction per design
 * §8) — `annotate` validates its shape and otherwise ignores it, so drafts can
 * be authored audio-ready before T09 exists.
 */

/** Pack-level meta, mirrored across every draft of the same pack. */
export const PackMetaSchema = z.strictObject({
  id: StableIdSchema,
  version: z.number().int().min(1),
  type: PackTypeSchema,
  title: LocalizedTextSchema,
  level: CefrLevelSchema,
  tags: z.array(z.string().min(1)),
  /** M14: content category slug (`news`, `podcast`, …); absent = `stories` app-side. */
  category: StableIdSchema.optional(),
  /** M14: fiction genre slug (`horror`, `comedy`, …); absent = app default. */
  genre: StableIdSchema.optional(),
});
export type PackMeta = z.infer<typeof PackMetaSchema>;

/** Meta of the one story this draft file contains. */
export const StoryMetaSchema = z.strictObject({
  id: StableIdSchema,
  title: LocalizedTextSchema,
  /** M14: optional dek / episode tagline / lesson subtitle. */
  subtitle: LocalizedTextSchema.optional(),
  /** M14: provenance (`name` at minimum; `publishedAt` for anything dated). */
  source: StorySourceSchema.optional(),
  level: CefrLevelSchema,
});
export type StoryMeta = z.infer<typeof StoryMetaSchema>;

/**
 * Optional ElevenLabs voice settings for one rendition (T09, additive).
 * All fields are provider-defined 0..1 knobs except `speed` (~0.7–1.2).
 */
export const VoiceSettingsSchema = z.strictObject({
  /** Lower = more expressive/variable, higher = more consistent. */
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  /** Style exaggeration; costs stability, use sparingly. */
  style: z.number().min(0).max(1).optional(),
  /** Playback speed multiplier applied at synthesis time. */
  speed: z.number().min(0.7).max(1.2).optional(),
  /** Provider "speaker boost" (similarity post-processing); the web UI default for cloned voices. */
  useSpeakerBoost: z.boolean().optional(),
});

/** Provider-prefixed voice id, e.g. "elevenlabs:Anton". */
const VoiceIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+:.+$/, 'voice is provider-prefixed, e.g. "elevenlabs:<voice-name>"');

/** One or more `[bracketed]` Eleven v3 audio tags, e.g. "[whispers] [fearful]". */
const AudioTagSchema = z
  .string()
  .regex(/^\[[^\]]+\](\s*\[[^\]]+\])*$/, 'audio tags are one or more [bracketed] v3 audio tags');

/**
 * Voice direction for one narration rendition (consumed by T09's
 * `pipeline audio`; carried through untouched by `annotate`).
 */
export const VoiceDirectionSchema = z
  .strictObject({
    /** Audio track id the rendition will get, e.g. "photo-anton-creepy". */
    id: StableIdSchema,
    /**
     * M14 register preset (`narrator | anchor | lecturer | host | voiceover |
     * guide`, LIBRARY_CATEGORIES §2.5): fills `voice` (→ `Mr. Wintrow`),
     * `style` (→ the slug), `settings` and `stylePrompt` unless authored here.
     * Without it, a pack `category` still implies its default register when
     * `settings`, `stylePrompt` and `style` are all absent (see registers.ts).
     */
    register: z.enum(REGISTER_SLUGS).optional(),
    /** Provider-prefixed voice id, e.g. "elevenlabs:Anton". Required unless `register` is set. */
    voice: VoiceIdSchema.optional(),
    /** Emotional/delivery style label: "creepy-whisper", "neutral", ... Required unless `register` is set. */
    style: z.string().min(1).optional(),
    /**
     * Optional ElevenLabs model id for this rendition (e.g.
     * `eleven_multilingual_v2`); overrides the CLI `--model` so a draft records
     * the model it was voiced with.
     */
    model: z.string().min(1).optional(),
    /** Prompt-style description of the delivery, for the TTS request. */
    stylePrompt: z.string().min(1).optional(),
    /** Free-form human notes on pacing, emphasis, pauses. */
    deliveryNotes: z.string().min(1).optional(),
    /** Optional provider voice settings for this rendition (T09, additive). */
    settings: VoiceSettingsSchema.optional(),
    /**
     * Optional Eleven v3 audio tag(s) prepended to the narration text, e.g.
     * "[whispers]" — steers delivery without being spoken (verified: tag chars
     * get ~0.1s of silence in the alignment). v3-family models only; ignored
     * for other models. Must be [bracketed] tags.
     */
    audioTag: AudioTagSchema.optional(),
    /**
     * Optional per-sentence audio cues (CT011 Tier 2): sentence id → one or
     * more [bracketed] v3 tags inserted right before that sentence in the
     * narration text (after its paragraph separator). Same mechanics as
     * `audioTag`, mid-text: v3-family models only, render-time only, never
     * spoken, never stamped, never written to pack.json. An id that is not in
     * the story is an error.
     */
    audioCues: z.record(StableIdSchema, AudioTagSchema).optional(),
    /**
     * Optional per-sentence voice override (CT011): sentence id → a different
     * provider-prefixed voice for that sentence. The story is rendered as
     * consecutive same-voice runs, each with its own voice; the runs are
     * level-matched and concatenated into the ONE track this direction
     * produces, with word stamps offset so they stay exact across every
     * splice. Override runs get no narrator `audioTag` (steer them with an
     * `audioCues` entry on the same id). Render-time only — never in
     * pack.json. An id that is not in the story is an error.
     */
    sentenceVoices: z.record(StableIdSchema, VoiceIdSchema).optional(),
    /**
     * Optional pre-rendered audio for a sentence (re-voice sessions): sentence
     * id → a path, relative to the draft file, of a clip that IS that
     * sentence's audio (e.g. a character line rendered by a voice the current
     * account no longer has, cut out of an earlier track). The sentence becomes
     * its own override run with NO provider request; a sibling
     * `<path>.stamps.json` (WordStamp[] relative to the clip start) supplies
     * its word stamps, otherwise the run ships stampless. Level-matched and
     * spliced exactly like `sentenceVoices`. Render-time only.
     */
    sentenceAudio: z.record(StableIdSchema, z.string().min(1)).optional(),
    /**
     * Optional context narration (any model): sentence id → a short text that
     * is rendered immediately BEFORE that sentence to steer its delivery
     * (mood, whisper, laughter — written in the story's language, in the
     * narrator's voice), then CUT OUT of the audio using the provider's
     * character timestamps, with every later word stamp shifted back by the
     * cut. The listener never hears it; it never reaches pack.json. Its
     * characters bill like any other. An id not in the story is an error.
     */
    contextCues: z.record(StableIdSchema, z.string().min(1)).optional(),
    /**
     * Optional ISO 639-1 language to enforce on the provider (`language_code`),
     * e.g. 'ru' — for models that accept it (multilingual v2 does).
     */
    language: z
      .string()
      .regex(/^[a-z]{2}$/, 'language is an ISO 639-1 code, e.g. "ru"')
      .optional(),
  })
  .superRefine((direction, ctx) => {
    // A direction with no register must be fully self-describing, exactly as
    // every pre-M14 draft was. (A pack `category` alone does not lift this:
    // its default register is resolved later, at render time.)
    if (direction.register !== undefined) return;
    for (const field of ['voice', 'style'] as const) {
      if (direction[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required unless "register" is set`,
        });
      }
    }
  });
export type VoiceDirection = z.infer<typeof VoiceDirectionSchema>;
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const FrontmatterSchema = z.strictObject({
  pack: PackMetaSchema,
  story: StoryMetaSchema,
  voice: z.array(VoiceDirectionSchema).optional(),
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
