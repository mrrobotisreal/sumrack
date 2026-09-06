import {
  CefrLevelSchema,
  LocalizedTextSchema,
  PackTypeSchema,
  StableIdSchema,
} from '@sumrak/schema';
import { z } from 'zod';

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
});
export type PackMeta = z.infer<typeof PackMetaSchema>;

/** Meta of the one story this draft file contains. */
export const StoryMetaSchema = z.strictObject({
  id: StableIdSchema,
  title: LocalizedTextSchema,
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
export const VoiceDirectionSchema = z.strictObject({
  /** Audio track id the rendition will get, e.g. "photo-anton-creepy". */
  id: StableIdSchema,
  /** Provider-prefixed voice id, e.g. "elevenlabs:Anton". */
  voice: VoiceIdSchema,
  /** Emotional/delivery style label: "creepy-whisper", "neutral", ... */
  style: z.string().min(1),
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
});
export type VoiceDirection = z.infer<typeof VoiceDirectionSchema>;
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const FrontmatterSchema = z.strictObject({
  pack: PackMetaSchema,
  story: StoryMetaSchema,
  voice: z.array(VoiceDirectionSchema).optional(),
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
