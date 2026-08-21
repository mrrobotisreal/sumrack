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

/**
 * Voice direction for one narration rendition (consumed by T09's
 * `pipeline audio`; carried through untouched by `annotate`).
 */
export const VoiceDirectionSchema = z.strictObject({
  /** Audio track id the rendition will get, e.g. "photo-anton-creepy". */
  id: StableIdSchema,
  /** Provider-prefixed voice id, e.g. "elevenlabs:Anton". */
  voice: z
    .string()
    .regex(/^[a-z0-9-]+:.+$/, 'voice is provider-prefixed, e.g. "elevenlabs:<voice-name>"'),
  /** Emotional/delivery style label: "creepy-whisper", "neutral", ... */
  style: z.string().min(1),
  /** Prompt-style description of the delivery, for the TTS request. */
  stylePrompt: z.string().min(1).optional(),
  /** Free-form human notes on pacing, emphasis, pauses. */
  deliveryNotes: z.string().min(1).optional(),
  /** Optional provider voice settings for this rendition (T09, additive). */
  settings: VoiceSettingsSchema.optional(),
});
export type VoiceDirection = z.infer<typeof VoiceDirectionSchema>;
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const FrontmatterSchema = z.strictObject({
  pack: PackMetaSchema,
  story: StoryMetaSchema,
  voice: z.array(VoiceDirectionSchema).optional(),
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
