import { beforeEach, describe, expect, it, vi } from 'vitest';

import SherpaSpeech from '../../../../modules/sherpa-speech';
import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { downloadModelArchive, resolveModelDownloadSpecs } from '@/features/models/install-source';
import { track } from '@/services/analytics';

import { ASSIST_MODEL } from '../assist-catalog';
import {
  assistMirrorState,
  deleteAssistModel,
  installAssistModel,
  isAssistInstalled,
  refreshInstalledAssist,
} from '../assist-manager';
import { transcribeEnglish, AssistNotInstalledError, ensureAssistLoaded } from '../assist-service';
import { useAssistStore } from '../assist-store';

/**
 * T59: manager + service paths with the native module and filesystem
 * mocked (the T11 seam — no native in vitest). A tiny in-memory FS stands
 * in for expo-file-system's File/Directory.
 */

const fs = new Set<string>();

vi.mock('expo-file-system', () => {
  class Entry {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return [...fs].some((p) => p === this.uri || p.startsWith(`${this.uri}/`));
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    delete() {
      for (const p of [...fs]) if (p === this.uri || p.startsWith(`${this.uri}/`)) fs.delete(p);
    }
    create() {
      fs.add(this.uri);
    }
  }
  class File extends Entry {
    get size() {
      return 1;
    }
  }
  class Directory extends Entry {
    list() {
      const prefix = `${this.uri}/`;
      return [...fs]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => new File(p));
    }
  }
  return { File, Directory, Paths: { document: 'doc', cache: 'cache' } };
});
vi.mock('../../../../modules/sherpa-speech', () => ({
  default: {
    dirSize: vi.fn().mockResolvedValue(104_000_000),
    extractTarBz2: vi.fn(),
    getLoadedWhisperId: vi.fn().mockReturnValue(null),
    unloadWhisper: vi.fn().mockResolvedValue(undefined),
    loadWhisper: vi.fn().mockResolvedValue({ loadMs: 900, alreadyLoaded: false }),
    transcribeWhisper: vi.fn(),
  },
}));
vi.mock('@/db', () => ({ repos: { settings: { set: vi.fn().mockResolvedValue(undefined) } } }));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('@/features/models/install-source', () => ({
  assertModelDownloadAllowed: vi.fn().mockResolvedValue(undefined),
  resolveModelDownloadSpecs: vi.fn(),
  downloadModelArchive: vi.fn(),
}));

const modelDir = `doc/assist-models/${ASSIST_MODEL.dirName}`;
function plantInstall(extra = false) {
  fs.add(`${modelDir}/${ASSIST_MODEL.files.encoder}`);
  fs.add(`${modelDir}/${ASSIST_MODEL.files.decoder}`);
  fs.add(`${modelDir}/${ASSIST_MODEL.files.tokens}`);
  if (extra) {
    fs.add(`${modelDir}/${ASSIST_MODEL.size}-encoder.onnx`);
    fs.add(`${modelDir}/${ASSIST_MODEL.size}-decoder.onnx`);
  }
}

beforeEach(() => {
  fs.clear();
  vi.clearAllMocks();
  useAssistStore.setState({ installedBytes: null, download: null, downloadError: null });
  vi.mocked(SherpaSpeech.getLoadedWhisperId).mockReturnValue(null);
});

describe('isAssistInstalled / refreshInstalledAssist', () => {
  it('is false with nothing on disk and mirrors {installed:false} into settings', async () => {
    expect(isAssistInstalled()).toBe(false);
    expect(await refreshInstalledAssist()).toBe(false);
    expect(useAssistStore.getState().installedBytes).toBeNull();
    expect(repos.settings.set).toHaveBeenCalledWith(
      SETTING_KEYS.scenarioAssistModel,
      assistMirrorState(false),
    );
  });

  it('needs all three files', () => {
    fs.add(`${modelDir}/${ASSIST_MODEL.files.encoder}`);
    fs.add(`${modelDir}/${ASSIST_MODEL.files.tokens}`);
    expect(isAssistInstalled()).toBe(false);
    fs.add(`${modelDir}/${ASSIST_MODEL.files.decoder}`);
    expect(isAssistInstalled()).toBe(true);
  });

  it('measures bytes and mirrors {installed:true, id} when installed', async () => {
    plantInstall();
    expect(await refreshInstalledAssist()).toBe(true);
    expect(useAssistStore.getState().installedBytes).toBe(104_000_000);
    expect(repos.settings.set).toHaveBeenCalledWith(SETTING_KEYS.scenarioAssistModel, {
      v: 1,
      installed: true,
      id: ASSIST_MODEL.id,
    });
  });

  it('a failing mirror write never breaks the scan', async () => {
    plantInstall();
    vi.mocked(repos.settings.set).mockRejectedValueOnce(new Error('db locked'));
    await expect(refreshInstalledAssist()).resolves.toBe(true);
  });
});

describe('installAssistModel', () => {
  it('resolves through the shared resolver, verifies+extracts, prunes fp32 twins, mirrors', async () => {
    vi.mocked(resolveModelDownloadSpecs).mockResolvedValueOnce([
      { source: 'content-repo', resolveUrl: async () => 'u', sha256: 'x', bytes: 1 },
    ]);
    vi.mocked(downloadModelArchive).mockImplementationOnce(async (_specs, _file, onPhase) => {
      onPhase('downloading', 0.5);
      onPhase('verifying', 1);
      return { source: 'content-repo' };
    });
    vi.mocked(SherpaSpeech.extractTarBz2).mockImplementationOnce(async () => {
      plantInstall(true);
      return { rootDir: ASSIST_MODEL.dirName, bytes: 5 };
    });

    await installAssistModel();

    expect(resolveModelDownloadSpecs).toHaveBeenCalledWith({
      id: ASSIST_MODEL.id,
      fallbackUrl: ASSIST_MODEL.archiveUrl,
      sha256: ASSIST_MODEL.archiveSha256,
      bytes: ASSIST_MODEL.archiveBytes,
    });
    expect(isAssistInstalled()).toBe(true);
    // fp32 twins pruned, int8 pair + tokens kept.
    expect(fs.has(`${modelDir}/${ASSIST_MODEL.size}-encoder.onnx`)).toBe(false);
    expect(fs.has(`${modelDir}/${ASSIST_MODEL.files.encoder}`)).toBe(true);
    expect(useAssistStore.getState().download).toBeNull();
    expect(useAssistStore.getState().installedBytes).toBe(104_000_000);
    expect(track).toHaveBeenCalledWith('assist_model_install_started', {
      modelId: ASSIST_MODEL.id,
      bytes: ASSIST_MODEL.archiveBytes,
      source: 'content-repo',
    });
    expect(track).toHaveBeenCalledWith(
      'assist_model_install_finished',
      expect.objectContaining({ modelId: ASSIST_MODEL.id, source: 'content-repo' }),
    );
  });

  it('a failed download leaves nothing installed, records the error, emits failed', async () => {
    vi.mocked(resolveModelDownloadSpecs).mockResolvedValueOnce([
      { source: 'upstream-fallback', url: 'u', sha256: 'x', bytes: 1 },
    ]);
    vi.mocked(downloadModelArchive).mockRejectedValueOnce(
      new Error('downloaded file failed integrity check'),
    );
    await expect(installAssistModel()).rejects.toThrow('integrity');
    expect(isAssistInstalled()).toBe(false);
    expect(useAssistStore.getState().downloadError).toContain('integrity');
    expect(track).toHaveBeenCalledWith('assist_model_install_failed', {
      modelId: ASSIST_MODEL.id,
      message: 'downloaded file failed integrity check',
      source: 'none',
    });
  });

  it('a wrong archive root is treated as a failed install (dir removed)', async () => {
    vi.mocked(resolveModelDownloadSpecs).mockResolvedValueOnce([
      { source: 'upstream-fallback', url: 'u', sha256: 'x', bytes: 1 },
    ]);
    vi.mocked(downloadModelArchive).mockResolvedValueOnce({ source: 'upstream-fallback' });
    vi.mocked(SherpaSpeech.extractTarBz2).mockImplementationOnce(async () => {
      fs.add(`${modelDir}/${ASSIST_MODEL.files.tokens}`);
      return { rootDir: 'something-else', bytes: 5 };
    });
    await expect(installAssistModel()).rejects.toThrow('expected model files');
    expect(fs.has(`${modelDir}/${ASSIST_MODEL.files.tokens}`)).toBe(false);
  });
});

describe('deleteAssistModel', () => {
  it('unloads a resident recognizer, deletes the dir, mirrors installed:false', async () => {
    plantInstall();
    await refreshInstalledAssist();
    vi.mocked(SherpaSpeech.getLoadedWhisperId).mockReturnValue(ASSIST_MODEL.id);
    await deleteAssistModel();
    expect(SherpaSpeech.unloadWhisper).toHaveBeenCalled();
    expect(isAssistInstalled()).toBe(false);
    expect(repos.settings.set).toHaveBeenLastCalledWith(
      SETTING_KEYS.scenarioAssistModel,
      assistMirrorState(false),
    );
    expect(track).toHaveBeenCalledWith('assist_model_deleted', {
      modelId: ASSIST_MODEL.id,
      bytes: 104_000_000,
    });
  });
});

describe('assist-service', () => {
  it('degrades cleanly with the model absent: typed error, native never called', async () => {
    expect(isAssistInstalled()).toBe(false);
    await expect(ensureAssistLoaded()).rejects.toBeInstanceOf(AssistNotInstalledError);
    await expect(transcribeEnglish('file:///a.wav')).rejects.toBeInstanceOf(
      AssistNotInstalledError,
    );
    expect(SherpaSpeech.loadWhisper).not.toHaveBeenCalled();
    expect(SherpaSpeech.transcribeWhisper).not.toHaveBeenCalled();
  });

  it('loads once, decodes in English, Zod-parses, emits the two events', async () => {
    plantInstall();
    vi.mocked(SherpaSpeech.transcribeWhisper).mockResolvedValueOnce({
      text: 'how do you say wallet',
      words: [{ word: 'wallet', startMs: 900, endMs: 1500 }],
      decodeMs: 640,
      audioMs: 1500,
    });
    const r = await transcribeEnglish('file:///a.wav');
    expect(SherpaSpeech.loadWhisper).toHaveBeenCalledWith(
      ASSIST_MODEL.id,
      `${modelDir}/${ASSIST_MODEL.files.encoder}`,
      `${modelDir}/${ASSIST_MODEL.files.decoder}`,
      `${modelDir}/${ASSIST_MODEL.files.tokens}`,
    );
    expect(SherpaSpeech.transcribeWhisper).toHaveBeenCalledWith('file:///a.wav', 'en');
    expect(r.text).toBe('how do you say wallet');
    expect(track).toHaveBeenCalledWith('whisper_loaded', { modelId: ASSIST_MODEL.id, loadMs: 900 });
    expect(track).toHaveBeenCalledWith('whisper_transcribed', {
      decodeMs: 640,
      audioMs: 1500,
      words: 1,
      language: 'en',
    });
  });

  it('rejects a malformed native transcript at the boundary', async () => {
    plantInstall();
    vi.mocked(SherpaSpeech.transcribeWhisper).mockResolvedValueOnce({ text: 1 } as never);
    await expect(transcribeEnglish('file:///a.wav')).rejects.toThrow();
  });
});
