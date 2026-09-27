import { Directory, File, Paths } from 'expo-file-system';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  assertModelDownloadAllowed,
  downloadModelArchive,
  resolveModelDownloadSpecs,
} from '@/features/models/install-source';
import type { ModelSourceKind } from '@/features/models/resolver-core';
import { track } from '@/services/analytics';

import { ASSIST_MODEL, type AssistModel, type AssistModelState } from './assist-catalog';
import { useAssistStore } from './assist-store';

/**
 * Assist (Whisper) model install/delete/scan (T59) — the T12 ASR manager's
 * twin: the filesystem is the source of truth for "installed", downloads
 * verify the pinned sha256 BEFORE extraction, failures leave no partial
 * install behind, the archive never transits JS memory, and the source
 * resolves through the shared T23 resolver (content repo — a Release asset
 * for this one, since the archive is over GitHub's 100 MB file limit —
 * then the pinned k2-fsa URL). On top of the ASR manager: every refresh
 * mirrors the state into `scenario.assistModel` (§4.4) so scenario code
 * can gate «как сказать» fallbacks without touching the filesystem.
 */

const ASSIST_DIR = 'assist-models';

export function assistRootDir(): Directory {
  return new Directory(Paths.document, ASSIST_DIR);
}

export function assistModelDir(model: AssistModel = ASSIST_MODEL): Directory {
  return new Directory(Paths.document, ASSIST_DIR, model.dirName);
}

/** The three paths sherpa-onnx needs to load the Whisper recognizer. */
export function assistModelPaths(model: AssistModel = ASSIST_MODEL) {
  const dir = assistModelDir(model);
  return {
    encoderPath: new File(dir, model.files.encoder).uri,
    decoderPath: new File(dir, model.files.decoder).uri,
    tokensPath: new File(dir, model.files.tokens).uri,
  };
}

export function isAssistInstalled(model: AssistModel = ASSIST_MODEL): boolean {
  const dir = assistModelDir(model);
  if (!dir.exists) return false;
  const paths = assistModelPaths(model);
  return (
    new File(paths.encoderPath).exists &&
    new File(paths.decoderPath).exists &&
    new File(paths.tokensPath).exists
  );
}

/** The §4.4 mirror row as it should read right now. */
export function assistMirrorState(installed: boolean): AssistModelState {
  return { v: 1, installed, id: ASSIST_MODEL.id };
}

/**
 * Scan the filesystem, refresh the store (storage accounting) and write
 * the `scenario.assistModel` mirror. Called at boot and after every
 * install/delete.
 */
export async function refreshInstalledAssist(): Promise<boolean> {
  const installed = isAssistInstalled();
  const bytes = installed ? await SherpaSpeech.dirSize(assistModelDir().uri).catch(() => 0) : null;
  useAssistStore.getState().setInstalledBytes(bytes);
  try {
    await repos.settings.set(SETTING_KEYS.scenarioAssistModel, assistMirrorState(installed));
  } catch (err) {
    // The mirror is a convenience; the filesystem stays the truth.
    console.warn('[assist] mirror write failed', err);
  }
  return installed;
}

let inFlight: Promise<void> | null = null;

/** Download → verify → extract the assist model. Concurrent calls join. */
export function installAssistModel(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = doInstall().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doInstall(): Promise<void> {
  const store = useAssistStore.getState();
  store.setDownloadError(null);
  store.setDownload({ phase: 'downloading', progress: 0 });
  const startedAt = Date.now();

  const root = assistRootDir();
  if (!root.exists) root.create({ intermediates: true });
  const archiveFile = new File(root, `${ASSIST_MODEL.dirName}.tar.bz2`);
  let usedSource: ModelSourceKind | null = null;

  try {
    await assertModelDownloadAllowed();
    const specs = await resolveModelDownloadSpecs({
      id: ASSIST_MODEL.id,
      fallbackUrl: ASSIST_MODEL.archiveUrl,
      sha256: ASSIST_MODEL.archiveSha256,
      bytes: ASSIST_MODEL.archiveBytes,
    });
    track('assist_model_install_started', {
      modelId: ASSIST_MODEL.id,
      bytes: ASSIST_MODEL.archiveBytes,
      source: specs[0]!.source,
    });

    const downloaded = await downloadModelArchive(specs, archiveFile, (phase, progress) => {
      useAssistStore.getState().setDownload({ phase, progress });
    });
    usedSource = downloaded.source;

    useAssistStore.getState().setDownload({ phase: 'extracting', progress: 1 });
    const extracted = await SherpaSpeech.extractTarBz2(archiveFile.uri, root.uri);
    if (extracted.rootDir !== ASSIST_MODEL.dirName || !isAssistInstalled()) {
      throw new Error('archive did not contain the expected model files');
    }
    // The archive also carries the fp32 twins (+ test WAVs) the module never
    // opens — drop them so the install costs the int8 pair, not 4× that.
    pruneUnusedModelFiles();

    await refreshInstalledAssist();
    track('assist_model_install_finished', {
      modelId: ASSIST_MODEL.id,
      ms: Date.now() - startedAt,
      bytes: ASSIST_MODEL.archiveBytes,
      source: usedSource,
    });
  } catch (err) {
    const dir = assistModelDir();
    if (dir.exists) {
      try {
        dir.delete();
      } catch {
        // best-effort cleanup
      }
    }
    const message = err instanceof Error ? err.message : 'download failed';
    useAssistStore.getState().setDownloadError(message);
    track('assist_model_install_failed', {
      modelId: ASSIST_MODEL.id,
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
    useAssistStore.getState().setDownload(null);
  }
}

/** Delete everything in the model dir except the three files the module loads. */
export function pruneUnusedModelFiles(model: AssistModel = ASSIST_MODEL): void {
  const keep = new Set(Object.values(model.files));
  const dir = assistModelDir(model);
  for (const entry of dir.list()) {
    if (entry instanceof File && keep.has(entry.name)) continue;
    try {
      entry.delete();
    } catch {
      // best-effort — a leftover fp32 file only costs storage
    }
  }
}

/** Delete the installed model and reclaim its storage. */
export async function deleteAssistModel(): Promise<void> {
  if (SherpaSpeech.getLoadedWhisperId() === ASSIST_MODEL.id) {
    await SherpaSpeech.unloadWhisper();
  }
  const dir = assistModelDir();
  const bytes = useAssistStore.getState().installedBytes ?? 0;
  if (dir.exists) dir.delete();
  await refreshInstalledAssist();
  track('assist_model_deleted', { modelId: ASSIST_MODEL.id, bytes });
}
