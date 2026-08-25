import { z } from 'zod';
import { StableIdSchema } from './common';

/**
 * `models-manifest.json` at the `sumrak-content` repo root (T23, V2 §2):
 * the index of self-hosted speech-model archives mirrored from the k2-fsa
 * release assets into `models/{tts,asr}/`. Deliberately a separate file and
 * schema from the pack `manifest.json` — the pack manifest's schemaVersion
 * is untouched by this addition.
 *
 * The app resolves model ids against this manifest first (content-repo
 * download, sha256 from here) and falls back to the pinned upstream k2-fsa
 * URL/hash constants when the manifest or repo is unreachable.
 */

/** What a mirrored archive is: a Piper TTS voice or the ASR model. */
export const ModelKindSchema = z.enum(['tts-voice', 'asr']);
export type ModelKind = z.infer<typeof ModelKindSchema>;

export const ModelsManifestEntrySchema = z.strictObject({
  /** Stable model id — matches the app catalog ids (e.g. "piper-ru-ruslan"). */
  id: StableIdSchema,
  kind: ModelKindSchema,
  /** Repo-relative archive path, always under "models/" (e.g. "models/tts/<archive>.tar.bz2"). */
  file: z
    .string()
    .min(1)
    .refine((p) => p.startsWith('models/') && !p.split('/').includes('..'), {
      message: 'model files live under "models/" (repo-relative, no "..")',
    }),
  /** Exact archive size in bytes (drives download progress UI). */
  bytes: z.number().int().positive(),
  /** Lowercase hex SHA-256 of the archive — verified before any install. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 is 64 lowercase hex characters'),
  /** Human name for Settings rows (e.g. "Руслан"). */
  displayName: z.string().min(1),
  /** Informational extras (e.g. the upstream URL the archive was mirrored from). */
  meta: z.record(z.string(), z.string()).optional(),
});
export type ModelsManifestEntry = z.infer<typeof ModelsManifestEntrySchema>;

export const ModelsManifestSchema = z
  .strictObject({
    /** Models-manifest format version (this shape = 1). */
    schemaVersion: z.literal(1),
    /** When the manifest was last regenerated (ISO 8601), informational. */
    generatedAt: z.iso.datetime({ offset: true }).optional(),
    /** One entry per mirrored model archive. */
    models: z.array(ModelsManifestEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.models.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['models', i, 'id'],
          message: `duplicate model id "${entry.id}" in models manifest`,
        });
      }
      seen.add(entry.id);
    });
  });
export type ModelsManifest = z.infer<typeof ModelsManifestSchema>;
