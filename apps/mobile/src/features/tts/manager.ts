import { Directory, File, Paths } from 'expo-file-system';

import SherpaSpeech from '../../../modules/sherpa-speech';
import {
  assertModelDownloadAllowed,
  downloadModelArchive,
  resolveModelDownloadSpecs,
} from '@/features/models/install-source';
import type { ModelSourceKind } from '@/features/models/resolver-core';
import { track } from '@/services/analytics';

import { getVoice, PIPER_VOICES, type PiperVoice } from './catalog';
import { useTtsStore, type InstalledVoice } from './store';

/**
 * Piper voice install/delete/scan (T11 model manager, design §6). The
 * filesystem is the source of truth for "installed": a voice dir under
 * documentDirectory/tts-voices/ with its model, tokens and espeak data
 * present. Downloads follow the T07 pattern — fetch with progress, verify
 * a pinned sha256 BEFORE anything is used, contain failures per voice —
 * but run through the native module for hashing/extraction because the
 * ~67 MB archives must never transit JS memory. T23: the archive source is
 * resolved through the shared model resolver (content repo first, pinned
 * k2-fsa URL as fallback); everything from extraction down is unchanged.
 */

const VOICES_DIR = 'tts-voices';

export function voicesRootDir(): Directory {
  return new Directory(Paths.document, VOICES_DIR);
}

export function voiceDir(voice: PiperVoice): Directory {
  return new Directory(Paths.document, VOICES_DIR, voice.dirName);
}

/** The three paths sherpa-onnx needs to load a Piper voice. */
export function voiceModelPaths(voice: PiperVoice) {
  const dir = voiceDir(voice);
  return {
    modelPath: new File(dir, voice.modelFile).uri,
    tokensPath: new File(dir, 'tokens.txt').uri,
    dataDir: new Directory(dir, 'espeak-ng-data').uri,
  };
}

export function isVoiceInstalled(voice: PiperVoice): boolean {
  const dir = voiceDir(voice);
  if (!dir.exists) return false;
  const paths = voiceModelPaths(voice);
  return (
    new File(paths.modelPath).exists &&
    new File(paths.tokensPath).exists &&
    new Directory(paths.dataDir).exists
  );
}

/**
 * Scan the filesystem for installed voices and refresh the store,
 * measuring on-disk size per voice (Settings storage accounting).
 */
export async function refreshInstalledVoices(): Promise<Record<string, InstalledVoice>> {
  const installed: Record<string, InstalledVoice> = {};
  for (const voice of PIPER_VOICES) {
    if (!isVoiceInstalled(voice)) continue;
    const bytes = await SherpaSpeech.dirSize(voiceDir(voice).uri).catch(() => 0);
    installed[voice.id] = { bytes };
  }
  useTtsStore.getState().setInstalled(installed);
  return installed;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Download → verify → extract one voice. Progress lands in the TTS store;
 * concurrent calls for the same voice join the in-flight install. Throws
 * (with a user-readable message) on failure, leaving no partial install
 * behind that the scanner would mistake for a working voice.
 */
export function installVoice(voiceId: string): Promise<void> {
  const existing = inFlight.get(voiceId);
  if (existing) return existing;
  const run = doInstallVoice(voiceId).finally(() => {
    inFlight.delete(voiceId);
  });
  inFlight.set(voiceId, run);
  return run;
}

async function doInstallVoice(voiceId: string): Promise<void> {
  const voice = getVoice(voiceId);
  if (!voice) throw new Error(`unknown voice: ${voiceId}`);
  const store = useTtsStore.getState();
  store.setDownloadError(voiceId, null);
  store.setDownload(voiceId, { phase: 'downloading', progress: 0 });
  const startedAt = Date.now();

  const root = voicesRootDir();
  if (!root.exists) root.create({ intermediates: true });
  const archiveFile = new File(root, `${voice.dirName}.tar.bz2`);
  let usedSource: ModelSourceKind | null = null;

  try {
    // 1. Wi-Fi-only gate + source resolution (T23): content repo when the
    //    models manifest lists this voice, pinned k2-fsa URL as fallback.
    await assertModelDownloadAllowed();
    const specs = await resolveModelDownloadSpecs({
      id: voice.id,
      fallbackUrl: voice.archiveUrl,
      sha256: voice.archiveSha256,
      bytes: voice.archiveBytes,
    });
    track('tts_voice_download_started', {
      voiceId,
      bytes: voice.archiveBytes,
      source: specs[0]!.source,
    });

    // 2. Download with progress + verify the manifest/pinned sha256 BEFORE
    //    extracting anything (T07 rule: nothing installs unverified). The
    //    shared downloader falls through content-repo → upstream on failure.
    const downloaded = await downloadModelArchive(specs, archiveFile, (phase, progress) => {
      useTtsStore.getState().setDownload(voiceId, { phase, progress });
    });
    usedSource = downloaded.source;

    // 3. Extract into the voices root (archive contains one top-level dir =
    //    voice.dirName), then confirm the files sherpa needs are present.
    useTtsStore.getState().setDownload(voiceId, { phase: 'extracting', progress: 1 });
    const extracted = await SherpaSpeech.extractTarBz2(archiveFile.uri, root.uri);
    if (extracted.rootDir !== voice.dirName || !isVoiceInstalled(voice)) {
      throw new Error('archive did not contain the expected voice files');
    }

    await refreshInstalledVoices();
    track('tts_voice_download_completed', {
      voiceId,
      ms: Date.now() - startedAt,
      bytes: voice.archiveBytes,
      source: usedSource,
    });
  } catch (err) {
    // Contain the failure: remove the partial voice dir so isVoiceInstalled
    // can never see a half-extracted voice.
    const dir = voiceDir(voice);
    if (dir.exists) {
      try {
        dir.delete();
      } catch {
        // best-effort cleanup
      }
    }
    const message = err instanceof Error ? err.message : 'download failed';
    useTtsStore.getState().setDownloadError(voiceId, message);
    track('tts_voice_download_failed', { voiceId, message, source: usedSource ?? 'none' });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    if (archiveFile.exists) {
      try {
        archiveFile.delete();
      } catch {
        // best-effort cleanup
      }
    }
    useTtsStore.getState().setDownload(voiceId, null);
  }
}

/** Delete an installed voice and reclaim its storage. */
export async function deleteVoice(voiceId: string): Promise<void> {
  const voice = getVoice(voiceId);
  if (!voice) return;
  if (SherpaSpeech.getLoadedVoiceId() === voiceId) {
    await SherpaSpeech.unloadVoice();
  }
  const dir = voiceDir(voice);
  const bytes = useTtsStore.getState().installed[voiceId]?.bytes ?? 0;
  if (dir.exists) dir.delete();
  await refreshInstalledVoices();
  track('tts_voice_deleted', { voiceId, bytes });
}

/** Total bytes used by all installed voices (Settings summary line). */
export function totalVoiceStorageBytes(): number {
  const { installed } = useTtsStore.getState();
  return Object.values(installed).reduce((sum, v) => sum + v.bytes, 0);
}
