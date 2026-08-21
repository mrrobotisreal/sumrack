import { z } from 'zod';

/**
 * Minimal versioned envelope for encrypted user-data backups (design §9).
 * **Stub — T20 owns the real payload format.** The payload is the encrypted,
 * gzipped export of the user tables only (never content tables, never
 * secrets); this envelope just carries enough metadata to identify, order,
 * and decrypt snapshots.
 */
export const BackupEnvelopeSchema = z.strictObject({
  /** Discriminator so a stray file is never mistaken for a backup. */
  format: z.literal('sumrak-backup'),
  /** Envelope format version (this shape = 1). T20 may bump it. */
  version: z.number().int().min(1),
  /** When the snapshot was taken (ISO 8601 with offset). */
  createdAt: z.iso.datetime({ offset: true }),
  /** App version that produced the snapshot, informational. */
  appVersion: z.string().min(1).optional(),
  /** AES-GCM parameters (key derived from Mitch's passphrase; key itself never stored). */
  cipher: z.strictObject({
    /** Cipher algorithm; only AES-256-GCM is supported (design §9). */
    alg: z.literal('aes-256-gcm'),
    /** Base64 KDF salt. */
    saltB64: z.string().min(1),
    /** Base64 GCM nonce/IV. */
    ivB64: z.string().min(1),
  }),
  /** Base64 ciphertext of the gzipped user-table export. */
  payloadB64: z.string().min(1),
});
export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;
