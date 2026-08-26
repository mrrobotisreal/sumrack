import type { Manifest, ManifestEntry, ManifestFile } from '@sumrak/schema';

import type { SyncStateRow } from '@/db/repositories/sync-state';

import { SyncError } from './errors';

/**
 * Pure content-sync decision logic (T07): manifest diffing, file
 * classification, and hash verification. No I/O — the device orchestration
 * in sync-service.ts feeds it; unit tests exercise it directly.
 */

export interface ManifestDiff {
  /** In the manifest, not installed at all. */
  toInstall: ManifestEntry[];
  /** Installed at a lower version than the manifest offers. */
  toUpdate: ManifestEntry[];
  /** Installed at (or above) the manifest version. */
  upToDate: ManifestEntry[];
  /**
   * Installed from github but no longer in the manifest. Never auto-removed
   * (removal is a user action on the pack management screen) — surfaced so
   * the UI can say so.
   */
  removedRemotely: SyncStateRow[];
  /**
   * Manifest entries whose id collides with an installed LOCAL pack (T28
   * `'local-import'` source). Local packs are invisible to sync — never
   * installed over, never version-compared, never removed — so a colliding
   * remote entry is skipped entirely and surfaced here for logging only.
   * (`imported-*` ids make this near-impossible; the guard is cheap.)
   */
  localCollisions: ManifestEntry[];
}

/**
 * Diff the remote manifest against `sync_state` (design §9: "diff versions").
 * The importer itself refuses downgrades, so a manifest entry older than the
 * installed version lands in `upToDate` (nothing to download).
 *
 * T28 local-pack immunity (design V2 §4.3, "the critical piece"): rows with
 * source `'local-import'` are removed from the diff universe up front —
 * no bucket except `localCollisions` can ever reference a local pack, by
 * construction. (`removedRemotely` was already github-only; the collision
 * guard closes the toInstall/toUpdate path too.)
 */
export function diffManifest(manifest: Manifest, installed: SyncStateRow[]): ManifestDiff {
  const localIds = new Set(
    installed.filter((row) => row.source === 'local-import').map((row) => row.packId),
  );
  const remoteInstalled = installed.filter((row) => row.source !== 'local-import');
  const installedById = new Map(remoteInstalled.map((row) => [row.packId, row]));
  const diff: ManifestDiff = {
    toInstall: [],
    toUpdate: [],
    upToDate: [],
    removedRemotely: [],
    localCollisions: [],
  };

  for (const entry of manifest.packs) {
    if (localIds.has(entry.id)) {
      diff.localCollisions.push(entry);
      continue;
    }
    const row = installedById.get(entry.id);
    if (!row) diff.toInstall.push(entry);
    else if (entry.version > row.version) diff.toUpdate.push(entry);
    else diff.upToDate.push(entry);
  }

  const remoteIds = new Set(manifest.packs.map((p) => p.id));
  diff.removedRemotely = remoteInstalled.filter(
    (row) => row.source === 'github' && !remoteIds.has(row.packId),
  );
  return diff;
}

/** Narration audio is the only large file class and the only Wi-Fi-gated one. */
export function isAudioFile(path: string): boolean {
  return path.startsWith('audio/') || /\.(opus|ogg|mp3|m4a|wav)$/i.test(path);
}

export interface PackFilePlan {
  packJson: ManifestFile;
  /** Audio files to download this run. */
  audio: ManifestFile[];
  /** Audio files deferred by the Wi-Fi-only setting (downloaded on a later Wi-Fi sync). */
  deferredAudio: ManifestFile[];
}

/**
 * Decide which of a pack's files to download. Audio is deferred — never the
 * pack itself — when the Wi-Fi-only-audio setting is on and the device is
 * not on Wi-Fi (design §9: "Wi-Fi-only toggle for audio"). Unknown file
 * types are ignored: the app only understands pack.json + audio, and a
 * newer manifest listing extra files must not break older app builds.
 */
export function planPackFiles(
  entry: ManifestEntry,
  opts: { wifiOnlyAudio: boolean; onWifi: boolean },
): PackFilePlan {
  const packJson = entry.files.find((f) => f.path === 'pack.json');
  if (!packJson) {
    // The manifest schema enforces pack.json's presence; guard for safety.
    throw new SyncError('invalid-manifest', `manifest entry "${entry.id}" lists no pack.json`);
  }
  const audioAll = entry.files.filter((f) => f.path !== 'pack.json' && isAudioFile(f.path));
  const defer = opts.wifiOnlyAudio && !opts.onWifi;
  return {
    packJson,
    audio: defer ? [] : audioAll,
    deferredAudio: defer ? audioAll : [],
  };
}

/** Lowercase-hex SHA-256 of raw bytes; injected so tests run on node crypto. */
export type Hasher = (bytes: Uint8Array) => Promise<string>;

/**
 * Verify downloaded bytes against the manifest hash (design §11: never
 * import unverified content — hard requirement, even for first-party packs).
 */
export async function verifyFileSha256(
  bytes: Uint8Array,
  expected: string,
  path: string,
  hasher: Hasher,
): Promise<void> {
  const actual = await hasher(bytes);
  if (actual !== expected.toLowerCase()) {
    throw new SyncError('sha256-mismatch', `sha256 mismatch for ${path}`, { path });
  }
}

/** Human-readable size for the management screen ("36.9 KB", "4.2 MB"). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
