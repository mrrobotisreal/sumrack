import { Directory, File, Paths } from 'expo-file-system';

import SherpaSpeech from '../../../modules/sherpa-speech';
import {
  assertModelDownloadAllowed,
  downloadModelArchive,
  resolveModelDownloadSpecs,
} from '@/features/models/install-source';
import type { ModelSourceKind } from '@/features/models/resolver-core';
import { track } from '@/services/analytics';

import { ASR_MODEL } from './asr-catalog';
import { useAsrStore } from './asr-store';

/**
 * ASR model install/delete/scan (T12) — the model-manager entry the ticket
 * requires, following T11's voice manager exactly: filesystem is the source
 * of truth for "installed", downloads verify the pinned sha256 BEFORE
 * extraction, failures leave no partial install behind, and the ~60 MB
 * archive never transits JS memory (native hash + extract). T23: the
 * archive source resolves through the same shared model resolver the TTS
 * manager uses (content repo first, pinned k2-fsa URL as fallback).
 */

const ASR_DIR = 'asr-models';

export function asrRootDir(): Directory {
  return new Directory(Paths.document, ASR_DIR);
}

export function asrModelDir(): Directory {
  return new Directory(Paths.document, ASR_DIR, ASR_MODEL.dirName);
}

/** The four paths sherpa-onnx needs to load the transducer recognizer. */
export function asrModelPaths() {
  const dir = asrModelDir();
  return {
    encoderPath: new File(dir, ASR_MODEL.files.encoder).uri,
    decoderPath: new File(dir, ASR_MODEL.files.decoder).uri,
    joinerPath: new File(dir, ASR_MODEL.files.joiner).uri,
    tokensPath: new File(dir, ASR_MODEL.files.tokens).uri,
  };
}

export function isAsrInstalled(): boolean {
  const dir = asrModelDir();
  if (!dir.exists) return false;
  const paths = asrModelPaths();
  return (
    new File(paths.encoderPath).exists &&
    new File(paths.decoderPath).exists &&
    new File(paths.joinerPath).exists &&
    new File(paths.tokensPath).exists
  );
}

/** Scan the filesystem and refresh the store (storage accounting). */
export async function refreshInstalledAsr(): Promise<boolean> {
  const installed = isAsrInstalled();
  const bytes = installed ? await SherpaSpeech.dirSize(asrModelDir().uri).catch(() => 0) : null;
  useAsrStore.getState().setInstalledBytes(bytes);
  return installed;
}

let inFlight: Promise<void> | null = null;

/** Download → verify → extract the ASR model. Concurrent calls join. */
export function installAsrModel(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = doInstall().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doInstall(): Promise<void> {
  const store = useAsrStore.getState();
  store.setDownloadError(null);
  store.setDownload({ phase: 'downloading', progress: 0 });
  const startedAt = Date.now();

  const root = asrRootDir();
  if (!root.exists) root.create({ intermediates: true });
  const archiveFile = new File(root, `${ASR_MODEL.dirName}.tar.bz2`);
  let usedSource: ModelSourceKind | null = null;

  try {
    // T23: Wi-Fi-only gate + shared source resolution (content repo →
    // pinned k2-fsa fallback), then download + sha256-verify before extract.
    await assertModelDownloadAllowed();
    const specs = await resolveModelDownloadSpecs({
      id: ASR_MODEL.id,
      fallbackUrl: ASR_MODEL.archiveUrl,
      sha256: ASR_MODEL.archiveSha256,
      bytes: ASR_MODEL.archiveBytes,
    });
    track('asr_model_download_started', {
      modelId: ASR_MODEL.id,
      bytes: ASR_MODEL.archiveBytes,
      source: specs[0]!.source,
    });

    const downloaded = await downloadModelArchive(specs, archiveFile, (phase, progress) => {
      useAsrStore.getState().setDownload({ phase, progress });
    });
    usedSource = downloaded.source;

    useAsrStore.getState().setDownload({ phase: 'extracting', progress: 1 });
    const extracted = await SherpaSpeech.extractTarBz2(archiveFile.uri, root.uri);
    if (extracted.rootDir !== ASR_MODEL.dirName || !isAsrInstalled()) {
      throw new Error('archive did not contain the expected model files');
    }

    await refreshInstalledAsr();
    track('asr_model_download_completed', {
      modelId: ASR_MODEL.id,
      ms: Date.now() - startedAt,
      bytes: ASR_MODEL.archiveBytes,
      source: usedSource,
    });
  } catch (err) {
    const dir = asrModelDir();
    if (dir.exists) {
      try {
        dir.delete();
      } catch {
        // best-effort cleanup
      }
    }
    const message = err instanceof Error ? err.message : 'download failed';
    useAsrStore.getState().setDownloadError(message);
    track('asr_model_download_failed', {
      modelId: ASR_MODEL.id,
      message,
      source: usedSource ?? 'none',
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    if (archiveFile.exists) {
      try {
        archiveFile.delete();
      } catch {
        // best-effort cleanup
      }
    }
    useAsrStore.getState().setDownload(null);
  }
}

/** Delete the installed model and reclaim its storage. */
export async function deleteAsrModel(): Promise<void> {
  if (SherpaSpeech.getLoadedAsrId() === ASR_MODEL.id) {
    await SherpaSpeech.unloadAsr();
  }
  const dir = asrModelDir();
  const bytes = useAsrStore.getState().installedBytes ?? 0;
  if (dir.exists) dir.delete();
  await refreshInstalledAsr();
  track('asr_model_deleted', { modelId: ASR_MODEL.id, bytes });
}
