/**
 * Typed sync failures (T07). Every code maps to a plain-language message —
 * design §6 states rule: errors are recoverable in place, never dead ends.
 * Messages must never include the PAT; they may include repo/path/status.
 */
export type SyncErrorCode =
  | 'not-configured'
  | 'offline'
  | 'auth'
  | 'not-found'
  | 'rate-limited'
  | 'http'
  | 'network'
  | 'sha256-mismatch'
  | 'invalid-manifest'
  | 'invalid-pack';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly path?: string;
  readonly status?: number;

  constructor(code: SyncErrorCode, message: string, opts?: { path?: string; status?: number }) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.path = opts?.path;
    this.status = opts?.status;
  }
}

/** User-facing one-liner for any error a sync run can surface. */
export function friendlySyncMessage(err: unknown): string {
  if (err instanceof SyncError) {
    switch (err.code) {
      case 'not-configured':
        return 'Content sync is not set up yet — add the repo and token in Settings.';
      case 'offline':
        return 'No connection — sync will retry when you are online.';
      case 'auth':
        return 'GitHub rejected the token. Check the PAT in Settings (it may have expired).';
      case 'not-found':
        return `Not found on GitHub: ${err.path ?? 'file'}. Check the repo name and token access.`;
      case 'rate-limited':
        return 'GitHub rate limit hit — try again in a few minutes.';
      case 'sha256-mismatch':
        return `Downloaded file failed verification (${err.path ?? 'file'}) — the pack was not installed.`;
      case 'invalid-manifest':
        return 'The content repo manifest.json is invalid — republish it from the pipeline.';
      case 'invalid-pack':
        return `A downloaded pack.json is invalid (${err.path ?? 'pack'}) — republish it from the pipeline.`;
      case 'http':
        return `GitHub request failed (HTTP ${err.status ?? '?'}) — try again.`;
      case 'network':
        return 'Network error while syncing — try again.';
    }
  }
  return err instanceof Error ? err.message : String(err);
}
