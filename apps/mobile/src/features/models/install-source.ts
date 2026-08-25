import type { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { getPat, getRepoConfig, getWifiOnlyAudio } from '@/features/sync/config';
import { GithubContentClient } from '@/features/sync/github-client';

import { getModelsManifest } from './manifest-cache';
import {
  evaluateModelDownloadGate,
  planModelSources,
  type ModelRef,
  type ModelSourceKind,
} from './resolver-core';

/**
 * The wired half of the shared model resolver (T23): both the TTS voice
 * manager and the ASR manager install through resolveModelDownloadSpecs +
 * downloadModelArchive — content repo first (manifest-listed, PAT-fetched),
 * pinned k2-fsa URL as last resort. The archives stream to disk via the
 * legacy FileSystem downloader and are hashed natively (T11 path) — they
 * never transit JS memory.
 */

export interface ModelDownloadSpec {
  source: ModelSourceKind;
  url: string;
  /**
   * Auth headers for content-repo downloads (carry the PAT — only ever
   * passed into the download call, never logged or attached to errors).
   */
  headers?: Record<string, string>;
  sha256: string;
  bytes: number;
}

/**
 * Ordered download specs for one model. Content-repo resolution requires
 * repo config + PAT + a manifest entry for the id; anything missing along
 * the way degrades to the pinned upstream fallback alone.
 */
export async function resolveModelDownloadSpecs(ref: ModelRef): Promise<ModelDownloadSpec[]> {
  const upstream: ModelDownloadSpec = {
    source: 'upstream-fallback',
    url: ref.fallbackUrl,
    sha256: ref.sha256,
    bytes: ref.bytes,
  };
  try {
    const config = await getRepoConfig();
    const pat = await getPat();
    if (!config || !pat) return [upstream];
    const client = new GithubContentClient(config, pat);
    const manifest = await getModelsManifest(client);
    return planModelSources(ref, manifest).map((planned): ModelDownloadSpec => {
      if (planned.source === 'content-repo') {
        const { url, headers } = client.rawDownloadDescriptor(planned.path);
        return {
          source: 'content-repo',
          url,
          headers,
          sha256: planned.sha256,
          bytes: planned.bytes,
        };
      }
      return {
        source: 'upstream-fallback',
        url: planned.url,
        sha256: planned.sha256,
        bytes: planned.bytes,
      };
    });
  } catch {
    // Resolution must never make installs worse than pre-T23: any surprise
    // (settings read, secure store) falls back to the pinned upstream URL.
    return [upstream];
  }
}

/**
 * The Wi-Fi-only gate (ticket item 5): throws a user-readable error when the
 * "Wi-Fi only" sync toggle blocks a (large) model download on cellular, or
 * when the device is provably offline.
 */
export async function assertModelDownloadAllowed(): Promise<void> {
  const wifiOnly = await getWifiOnlyAudio();
  const network = await Network.getNetworkStateAsync().catch(() => null);
  const gate = evaluateModelDownloadGate(wifiOnly, {
    reachable: network?.isInternetReachable ?? null,
    onWifi:
      network?.type === Network.NetworkStateType.WIFI ||
      network?.type === Network.NetworkStateType.ETHERNET,
  });
  if (!gate.allowed) throw new Error(gate.message);
}

export interface DownloadArchiveResult {
  /** Which source actually served the verified archive. */
  source: ModelSourceKind;
}

/**
 * Try each spec in order: stream-download to `archiveFile`, verify its
 * sha256 natively against the spec BEFORE reporting success. A failed
 * attempt (HTTP error, hash mismatch) deletes the partial file and falls
 * through to the next source; only when every source fails does the last
 * error surface.
 */
export async function downloadModelArchive(
  specs: ModelDownloadSpec[],
  archiveFile: File,
  onPhase: (phase: 'downloading' | 'verifying', progress: number) => void,
): Promise<DownloadArchiveResult> {
  let lastError: Error | null = null;
  for (const spec of specs) {
    try {
      onPhase('downloading', 0);
      const download = LegacyFileSystem.createDownloadResumable(
        spec.url,
        archiveFile.uri,
        { headers: spec.headers },
        (p) => {
          const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : spec.bytes;
          onPhase('downloading', Math.min(1, p.totalBytesWritten / total));
        },
      );
      const result = await download.downloadAsync();
      if (!result || result.status !== 200) {
        throw new Error(`download failed (HTTP ${result?.status ?? '—'})`);
      }
      onPhase('verifying', 1);
      const digest = await SherpaSpeech.sha256File(archiveFile.uri);
      if (digest !== spec.sha256) {
        throw new Error('downloaded file failed integrity check');
      }
      // Kept in release builds: model installs are rare, and which source
      // served one is exactly what T23's fallback chain needs observable.
      console.log(`[models] verified archive from ${spec.source}`);
      return { source: spec.source };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('download failed');
      if (archiveFile.exists) {
        try {
          archiveFile.delete();
        } catch {
          // best-effort cleanup before the next attempt
        }
      }
      // Source + message only — never the spec (its headers carry the PAT).
      console.warn(`[models] ${spec.source} download failed: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error('download failed');
}
