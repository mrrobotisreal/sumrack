/** Sync server (T103), live behind a Cloudflare tunnel. Not a secret. Overridable in Settings → «Сервер». */
export const DEFAULT_SYNC_URL = 'https://sumrak.winapps.dev';

/** Sent as `schemaVersion` on push: the local migration index that defines the synced shapes. */
export const SYNC_SCHEMA_VERSION = 23;

/** Server limits (SumrakAPI internal/sync): changes per push, pk bytes, data bytes. */
export const MAX_PUSH_CHANGES = 500;
export const MAX_PK_BYTES = 512;
export const MAX_DATA_BYTES = 256 * 1024;
/** Soft cap for one push body (the server's maxPushBytes is config; stay well under). */
export const MAX_PUSH_BODY_BYTES = 4 * 1024 * 1024;
export const PULL_PAGE = 500;
