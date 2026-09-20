import { z } from 'zod';
import {
  CefrLevelSchema,
  LocalizedTextSchema,
  PackTypeSchema,
  RelativePathSchema,
  StableIdSchema,
} from './common';

/**
 * One file belonging to a pack, as listed in the manifest: its path relative
 * to the pack directory and its content hash for download verification
 * (design §9: "download changed packs ... verify sha256").
 */
export const ManifestFileSchema = z.strictObject({
  /** Path relative to the pack dir, e.g. "pack.json" or "audio/story1-voice1.opus". */
  path: RelativePathSchema,
  /** Lowercase hex SHA-256 of the file contents. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 is 64 lowercase hex characters'),
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

/**
 * One pack's index entry (design §4.2 tail): everything the app needs to
 * decide whether to download/update the pack without fetching it.
 */
export const ManifestEntrySchema = z.strictObject({
  /** The pack's stable id — matches `Pack.id`. */
  id: StableIdSchema,
  /** The pack's version — matches `Pack.version`; the app diffs this against installed versions. */
  version: z.number().int().min(1),
  /** The pack's type — matches `Pack.type`. */
  type: PackTypeSchema,
  /** The pack's CEFR level — matches `Pack.level`. */
  level: CefrLevelSchema,
  /** The pack's bilingual title — matches `Pack.title` (shown pre-download). */
  title: LocalizedTextSchema,
  /**
   * M14 §2.3: mirrors `Pack.category` when the pack has one (metadata for
   * the packs screen / future selective sync). Optional — no schemaVersion bump.
   */
  category: StableIdSchema.optional(),
  /** Total size of all pack files in bytes (drives download UI / Wi-Fi-only decisions). */
  bytes: z.number().int().positive(),
  /** Every file in the pack with its hash. Always includes "pack.json". */
  files: z.array(ManifestFileSchema).min(1),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/**
 * The top-level `manifest.json` in the `sumrak-content` repo: the index of
 * all packs the app diffs against installed versions to decide downloads
 * (design §4.2/§9). Shape pinned in T02: a versioned envelope around the
 * entry list so the manifest format itself can evolve.
 */
export const ManifestSchema = z
  .strictObject({
    /** Manifest format version (this shape = 1). */
    schemaVersion: z.literal(1),
    /** When the manifest was last regenerated (ISO 8601), informational. */
    generatedAt: z.iso.datetime({ offset: true }).optional(),
    /** One entry per published pack. */
    packs: z.array(ManifestEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.packs.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['packs', i, 'id'],
          message: `duplicate pack id "${entry.id}" in manifest`,
        });
      }
      seen.add(entry.id);
      if (!entry.files.some((f) => f.path === 'pack.json')) {
        ctx.addIssue({
          code: 'custom',
          path: ['packs', i, 'files'],
          message: 'every pack must list a "pack.json" file',
        });
      }
    });
  });
export type Manifest = z.infer<typeof ManifestSchema>;
