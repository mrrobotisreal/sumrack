import { parseManifest, type ManifestEntry } from '@sumrak/schema';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';

import { db, repos } from '@/db';
import { importPack, removePack } from '@/db/importer';
import { notifyNewContent } from '@/features/motivation/notifications';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { queryKeys } from '@/db/hooks';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import { getPat, getRepoConfig, getWifiOnlyAudio } from './config';
import { friendlySyncMessage, SyncError } from './errors';
import { GithubContentClient } from './github-client';
import {
  diffManifest,
  isAudioFile,
  planPackFiles,
  verifyFileSha256,
  type Hasher,
} from './sync-core';
import { useSyncStatus, type SyncRunSummary } from './store';

/**
 * The T07 content-sync orchestrator (design §9): fetch manifest → diff
 * against sync_state → download + sha256-verify changed files → import via
 * the T03 importer → record state. Failures are contained per pack; a
 * verification or validation failure aborts that pack BEFORE anything is
 * imported, so the previously-installed version stays fully usable.
 */

/** Auto-checks (app foreground) at most every 15 minutes; manual sync always runs. */
export const AUTO_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const MANIFEST_PATH = 'manifest.json';

/** Device hasher: expo-crypto SHA-256 over raw bytes → lowercase hex. */
const deviceHasher: Hasher = async (bytes) => {
  // Cast: our byte arrays are always backed by a plain ArrayBuffer (fetch/
  // file reads), never a SharedArrayBuffer — TS can't see that through the
  // Uint8Array<ArrayBufferLike> generic.
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

let syncInFlight: Promise<SyncRunSummary> | null = null;

export interface RunSyncOptions {
  /** 'manual' bypasses the throttle and surfaces every outcome. */
  trigger: 'auto' | 'manual';
}

/** Entry point for every sync trigger. Concurrent calls join the in-flight run. */
export function runSync(opts: RunSyncOptions): Promise<SyncRunSummary> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = doRunSync(opts).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doRunSync({ trigger }: RunSyncOptions): Promise<SyncRunSummary> {
  const status = useSyncStatus.getState();
  const summary: SyncRunSummary = {
    at: Date.now(),
    trigger,
    outcome: 'ok',
    installed: [],
    updated: [],
    audioDeferred: [],
    packErrors: [],
  };

  const skip = (reason: NonNullable<SyncRunSummary['skipReason']>): SyncRunSummary => {
    summary.outcome = 'skipped';
    summary.skipReason = reason;
    status.finishRun(summary);
    return summary;
  };

  // Throttle auto-checks (ticket item 6); manual runs always proceed.
  if (trigger === 'auto') {
    const last = await repos.settings.get<number>(SETTING_KEYS.lastSyncCheckAt);
    if (last && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return skip('throttled');
  }

  const config = await getRepoConfig();
  const pat = await getPat();
  if (!config || !pat) {
    if (trigger === 'manual') {
      summary.outcome = 'error';
      summary.error = friendlySyncMessage(new SyncError('not-configured', 'sync not configured'));
      track('sync_failed', { trigger, code: 'not-configured' });
      status.finishRun(summary);
      return summary;
    }
    return skip('not-configured');
  }

  const network = await Network.getNetworkStateAsync().catch(() => null);
  if (network && network.isInternetReachable === false) {
    // Offline is a normal state for this app, never an error (design §3.1).
    return trigger === 'manual'
      ? failRun(summary, new SyncError('offline', 'offline'))
      : skip('offline');
  }
  const onWifi =
    network?.type === Network.NetworkStateType.WIFI ||
    network?.type === Network.NetworkStateType.ETHERNET;

  status.startRun('checking');
  track('sync_check_started', { trigger });

  const client = new GithubContentClient(config, pat);

  let manifest;
  try {
    const manifestBytes = await client.fetchRawFile(MANIFEST_PATH);
    manifest = parseManifestBytes(manifestBytes);
    // A successful manifest fetch counts as the check, whatever follows.
    await repos.settings.set(SETTING_KEYS.lastSyncCheckAt, Date.now());
  } catch (err) {
    return failRun(summary, err);
  }

  const installed = await repos.syncState.listInstalled();
  const diff = diffManifest(manifest, installed);
  const wifiOnlyAudio = await getWifiOnlyAudio();
  const changed = [...diff.toInstall, ...diff.toUpdate];

  for (const [i, entry] of changed.entries()) {
    try {
      const plan = planPackFiles(entry, { wifiOnlyAudio, onWifi });
      const fileCount = 1 + plan.audio.length;
      const progress = {
        packId: entry.id,
        titleEn: entry.title.en,
        packIndex: i + 1,
        packCount: changed.length,
        filesDone: 0,
        fileCount,
      };
      useSyncStatus.getState().setProgress(progress);

      // 1. pack.json: download → verify → parse. Nothing installs unverified.
      const packBytes = await client.fetchRawFile(`packs/${entry.id}/${plan.packJson.path}`);
      await verifyFileSha256(packBytes, plan.packJson.sha256, plan.packJson.path, deviceHasher);
      const rawPack = parsePackBytes(packBytes, entry.id);
      useSyncStatus.getState().setProgress({ ...progress, filesDone: 1 });

      // 2. Audio: download → verify → stage into app storage (§4.3).
      const audioFiles: Record<string, string> = {};
      for (const [j, file] of plan.audio.entries()) {
        const bytes = await client.fetchRawFile(`packs/${entry.id}/${file.path}`);
        await verifyFileSha256(bytes, file.sha256, file.path, deviceHasher);
        audioFiles[file.path] = stageAudioFile(entry.id, file.path, bytes);
        useSyncStatus.getState().setProgress({ ...progress, filesDone: 2 + j });
      }
      if (plan.deferredAudio.length > 0) {
        summary.audioDeferred.push(entry.id);
        track('audio_deferred_wifi', { packId: entry.id, files: plan.deferredAudio.length });
      }

      // 3. Import through T03 (validates again with Zod, upserts by stable
      //    ids, replaces content rows on version bump, preserves user refs).
      const result = await importPack(db, rawPack, { source: 'github', audioFiles });
      await repos.syncState.setBytes(entry.id, entry.bytes);

      if (result.action === 'installed') summary.installed.push(entry.id);
      else if (result.action === 'updated') summary.updated.push(entry.id);
      track('pack_imported', {
        packId: entry.id,
        version: entry.version,
        action: result.action,
        source: 'github',
      });
    } catch (err) {
      // Contain the failure to this pack: the transaction in importPack means
      // nothing partial was written; staged audio files are harmless orphans
      // that the next successful sync overwrites.
      const message = friendlySyncMessage(err);
      summary.packErrors.push({ packId: entry.id, message });
      const code = err instanceof SyncError ? err.code : 'unknown';
      console.warn(`[sync] pack ${entry.id} failed: ${code}`);
      track('sync_pack_failed', { packId: entry.id, code });
    }
  }

  // 4. Backfill audio that an earlier cellular sync deferred (Wi-Fi now, or
  //    the toggle turned off): up-to-date packs whose tracks have no local file.
  if (!wifiOnlyAudio || onWifi) {
    for (const entry of diff.upToDate) {
      try {
        await backfillMissingAudio(client, entry);
      } catch (err) {
        const code = err instanceof SyncError ? err.code : 'unknown';
        console.warn(`[sync] audio backfill for ${entry.id} failed: ${code}`);
        track('sync_pack_failed', { packId: entry.id, code, stage: 'audio-backfill' });
      }
    }
  }

  if (summary.installed.length > 0 || summary.updated.length > 0) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
    ]);
  }

  // T19: local "new packs available" notice (prefs/quiet-hours gated inside).
  if (summary.installed.length > 0) {
    void notifyNewContent(summary.installed.length);
  }

  summary.outcome = summary.packErrors.length > 0 ? 'error' : 'ok';
  track('sync_completed', {
    trigger,
    installed: summary.installed.length,
    updated: summary.updated.length,
    errors: summary.packErrors.length,
    audioDeferred: summary.audioDeferred.length,
  });
  useSyncStatus.getState().finishRun(summary);
  return summary;
}

function failRun(summary: SyncRunSummary, err: unknown): SyncRunSummary {
  summary.outcome = 'error';
  summary.error = friendlySyncMessage(err);
  const code = err instanceof SyncError ? err.code : 'unknown';
  console.warn(`[sync] run failed: ${code}`);
  track('sync_failed', { trigger: summary.trigger, code });
  useSyncStatus.getState().finishRun(summary);
  return summary;
}

function parseManifestBytes(bytes: Uint8Array) {
  try {
    return parseManifest(JSON.parse(decodeUtf8(bytes)));
  } catch (err) {
    throw new SyncError(
      'invalid-manifest',
      err instanceof Error ? err.message : 'manifest.json failed validation',
      { path: MANIFEST_PATH },
    );
  }
}

/** Parse pack.json bytes to a raw object; schema validation happens in importPack. */
function parsePackBytes(bytes: Uint8Array, packId: string): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new SyncError('invalid-pack', `packs/${packId}/pack.json is not valid JSON`, {
      path: `packs/${packId}/pack.json`,
    });
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Write verified audio bytes to documentDirectory/packs/<packId>/<relPath>
 * (same layout the T03 bootstrap stages bundled audio into) and return the
 * file URI for audio_tracks.localUri.
 */
function stageAudioFile(packId: string, relPath: string, bytes: Uint8Array): string {
  const parts = relPath.split('/');
  const fileName = parts.pop()!;
  const dir = new Directory(Paths.document, 'packs', packId, ...parts);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, fileName);
  dest.write(bytes);
  return dest.uri;
}

/**
 * For an installed, up-to-date pack: download any manifest audio file whose
 * audio_track (or dialogue_node_audio row, T26) has no localUri yet
 * (deferred on cellular earlier), verify, stage, and record the uri.
 */
async function backfillMissingAudio(client: GithubContentClient, entry: ManifestEntry) {
  const [tracks, dialogueAudio] = await Promise.all([
    repos.content.listAudioTracksForPack(entry.id),
    repos.dialogues.listAudioForPack(entry.id),
  ]);
  const missing = [...tracks, ...dialogueAudio].filter(
    (t) => !t.localUri || !new File(t.localUri).exists,
  );
  if (missing.length === 0) return;

  const manifestByPath = new Map(
    entry.files.filter((f) => isAudioFile(f.path)).map((f) => [f.path, f]),
  );
  const isDialogueFile = new Set(dialogueAudio.map((a) => a.file));
  for (const audioRow of missing) {
    const file = manifestByPath.get(audioRow.file);
    if (!file) continue; // manifest no longer ships this file
    const bytes = await client.fetchRawFile(`packs/${entry.id}/${file.path}`);
    await verifyFileSha256(bytes, file.sha256, file.path, deviceHasher);
    const uri = stageAudioFile(entry.id, file.path, bytes);
    if (isDialogueFile.has(audioRow.file)) {
      await repos.dialogues.setAudioLocalUri(entry.id, audioRow.file, uri);
    } else {
      await repos.content.setAudioLocalUri(entry.id, audioRow.file, uri);
    }
    track('audio_backfilled', { packId: entry.id, file: file.path });
  }
}

/**
 * Pack removal for the management screen: content rows + sync_state via T03.
 * Note: a pack still listed in the manifest reinstalls on the next sync
 * (same semantics as bundled packs re-importing at boot) — the UI says so.
 */
export async function removeInstalledPack(packId: string): Promise<void> {
  await removePack(db, packId);
  track('pack_removed', { packId, source: 'management-screen' });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
  ]);
}
