import { SyncError } from '@/features/sync/errors';

/**
 * Typed backup/restore failures (T20). Same contract as SyncError (T07):
 * every code maps to a plain-language, recoverable-in-place message, and no
 * message ever contains the passphrase, derived key, or PAT.
 */
export type BackupErrorCode =
  /** No passphrase configured yet — backups can't run. */
  | 'not-configured'
  /** Passphrase configured but the derived key is missing from the Keystore. */
  | 'no-key'
  | 'offline'
  /** GitHub target failed (wraps a SyncError code in `message`). */
  | 'github'
  /** File is not a sumrak-backup envelope (or is a corrupted one). */
  | 'invalid-envelope'
  /** Wrong passphrase OR ciphertext corruption — AES-GCM cannot tell them apart. */
  | 'decrypt-failed'
  /** Decrypted payload failed Zod validation — nothing was written. */
  | 'invalid-payload'
  /** Storage Access Framework folder permission missing/revoked. */
  | 'saf-denied'
  | 'file-error'
  | 'unknown';

export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** Map any thrown value to a BackupError, wrapping SyncError from the GitHub client. */
export function toBackupError(err: unknown): BackupError {
  if (err instanceof BackupError) return err;
  if (err instanceof SyncError) {
    if (err.code === 'offline') return new BackupError('offline', 'offline');
    return new BackupError('github', `GitHub ${err.code}${err.status ? ` (${err.status})` : ''}`);
  }
  return new BackupError('unknown', err instanceof Error ? err.message : String(err));
}

/** User-facing one-liner for any error a backup/restore run can surface. */
export function friendlyBackupMessage(err: unknown): string {
  const e = toBackupError(err);
  switch (e.code) {
    case 'not-configured':
      return 'Backups are not set up yet — set a passphrase in Settings → Backup.';
    case 'no-key':
      return 'The backup key is missing from the Keystore — re-enter your passphrase in Settings → Backup.';
    case 'offline':
      return 'No connection — the backup will run next time you are online.';
    case 'github':
      return `GitHub backup failed: ${e.message}. Check the repo and token in Settings (the PAT needs read-write Contents access).`;
    case 'invalid-envelope':
      return 'That file is not a Sumrak backup (or it is corrupted).';
    case 'decrypt-failed':
      return 'Could not decrypt the backup — wrong passphrase, or the file is corrupted. Nothing was changed.';
    case 'invalid-payload':
      return 'The backup decrypted but its contents failed validation — nothing was changed. The file may be from an incompatible app version.';
    case 'saf-denied':
      return 'Folder access was not granted — pick a folder to continue.';
    case 'file-error':
      return `File error: ${e.message}`;
    case 'unknown':
      return e.message || 'Backup failed — try again.';
  }
}
