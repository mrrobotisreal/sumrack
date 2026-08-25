import { z } from 'zod';

/**
 * CEFR proficiency level. The app targets A1 → C1+ (design §1); C2 is
 * intentionally not modeled — content is never tagged past C1.
 */
export const CefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1']);
export type CefrLevel = z.infer<typeof CefrLevelSchema>;

/**
 * The pack types (design §4.1 + V2 §3.1):
 * - `stories` — a set of stories/articles (the common case)
 * - `course-unit` — a guided-path unit: references stories, includes a grammar
 *   mini-lesson, exercise config, and prompts
 * - `checkpoint` — a level checkpoint test (e.g., "A1 → A2 Checkpoint")
 * - `prompts` — journal prompt collections
 * - `dialogue` — branching speak-your-choice dialogues (T25, V2 §3)
 */
export const PackTypeSchema = z.enum([
  'stories',
  'course-unit',
  'checkpoint',
  'prompts',
  'dialogue',
]);
export type PackType = z.infer<typeof PackTypeSchema>;

/**
 * A bilingual text pair: `ru` is the Russian content, `en` the natural English
 * counterpart. Used for pack/story titles and anywhere both languages ship
 * together (design §4.2 `title: LocalizedText`).
 */
export const LocalizedTextSchema = z
  .strictObject({
    /** Russian text (UTF-8 NFC, ё preserved as authored). */
    ru: z.string().min(1),
    /** English text. */
    en: z.string().min(1),
  })
  .superRefine((t, ctx) => {
    if (t.ru !== t.ru.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ru'],
        message: 'Russian text must be UTF-8 NFC-normalized',
      });
    }
  });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/**
 * A stable, human-readable string id. Ids are never renumbered or reused
 * (roadmap §3 conventions); user data references them across pack versions.
 */
export const StableIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    'ids are lowercase kebab-case (letters/digits/hyphens), stable, never renumbered',
  );

/**
 * A relative file path inside a pack directory (e.g. "audio/story1-voice1.opus").
 * Never absolute, never escaping the pack dir.
 */
export const RelativePathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), {
    message: 'must be a relative path inside the pack directory (no leading "/", no "..")',
  });
