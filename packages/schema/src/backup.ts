import { z } from 'zod';

/**
 * Versioned envelope for encrypted user-data backups (design §9, format
 * finalized in T20). The payload is the AES-256-GCM-encrypted, gzipped JSON
 * export of the user tables only (never content tables, never secrets); the
 * envelope carries exactly enough metadata to identify, order, and decrypt a
 * snapshot **on a fresh device knowing only the passphrase** — so the KDF
 * parameters (salt, iterations) ride along in every file. The salt is not
 * secret; the passphrase (and the key derived from it) never leaves the
 * device's Keystore. T21's `syncd` target stores these same files verbatim.
 */
export const BackupEnvelopeSchema = z.strictObject({
  /** Discriminator so a stray file is never mistaken for a backup. */
  format: z.literal('sumrak-backup'),
  /** Envelope format version (this shape = 1). Bump on breaking change. */
  version: z.literal(1),
  /** When the snapshot was taken (ISO 8601 with offset). */
  createdAt: z.iso.datetime({ offset: true }),
  /** App version that produced the snapshot, informational. */
  appVersion: z.string().min(1).optional(),
  /** AES-GCM + KDF parameters (key derived from Mitch's passphrase; key itself never stored). */
  cipher: z.strictObject({
    /** Cipher algorithm; only AES-256-GCM is supported (design §9). */
    alg: z.literal('aes-256-gcm'),
    /** Key derivation function; only PBKDF2-HMAC-SHA256 is supported. */
    kdf: z.literal('pbkdf2-sha256'),
    /** PBKDF2 iteration count used when this snapshot's key was derived. */
    iterations: z.number().int().min(1),
    /** Base64 KDF salt (generated once at passphrase setup, not secret). */
    saltB64: z.string().min(1),
    /** Base64 GCM nonce/IV (fresh random per snapshot). */
    ivB64: z.string().min(1),
  }),
  /** Base64 ciphertext of the gzipped user-table export. */
  payloadB64: z.string().min(1),
});
export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;
