import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsManifestSchema } from '@sumrak/schema';
import {
  GITHUB_TREE_FILE_LIMIT,
  MIRROR_MODELS,
  MODELS_MANIFEST_FILE,
  mirrorFilePath,
  releaseAssetName,
  runModelsMirror,
  type Downloader,
  type MirrorModel,
  type ReleaseStore,
} from '../src/models.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 't23-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeContentRepo(): string {
  const dir = tempDir();
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't23@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T23 Test'], { cwd: dir });
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, packs: [] }, null, 2)}\n`,
  );
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function gitStatus(dir: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Tiny stand-in archives whose pinned sha256 really matches their bytes. */
const FAKE_BYTES: Record<string, string> = {
  'fake-voice': 'FAKE VOICE ARCHIVE BYTES',
  'fake-asr': 'FAKE ASR ARCHIVE BYTES',
};
const FAKE_MODELS: readonly MirrorModel[] = [
  {
    id: 'fake-voice',
    kind: 'tts-voice',
    upstreamUrl: 'https://upstream.example/tts-models/fake-voice.tar.bz2',
    sha256: sha256(FAKE_BYTES['fake-voice']!),
    bytes: FAKE_BYTES['fake-voice']!.length,
    displayName: 'Fake voice',
  },
  {
    id: 'fake-asr',
    kind: 'asr',
    upstreamUrl: 'https://upstream.example/asr-models/fake-asr.tar.bz2',
    sha256: sha256(FAKE_BYTES['fake-asr']!),
    bytes: FAKE_BYTES['fake-asr']!.length,
    displayName: 'Fake ASR',
  },
];
const fakeDownloader: Downloader = async (url, dest) => {
  const id = url.split('/').pop()!.replace('.tar.bz2', '');
  writeFileSync(dest, FAKE_BYTES[id]!);
};

/** In-memory ReleaseStore (T59 seam): never touches GitHub. */
function fakeReleases(): ReleaseStore & { assets: Map<string, string[]>; uploads: string[] } {
  const assets = new Map<string, string[]>();
  const uploads: string[] = [];
  return {
    assets,
    uploads,
    async listAssets(tag) {
      return [...(assets.get(tag) ?? [])];
    },
    async ensureRelease(tag) {
      if (!assets.has(tag)) assets.set(tag, []);
    },
    async upload(tag, file, assetName) {
      if (assets.get(tag)?.includes(assetName)) throw new Error('asset exists');
      uploads.push(readFileSync(file, 'utf8'));
      assets.get(tag)!.push(assetName);
    },
  };
}

const FAKE_RELEASE_BYTES = 'FAKE BIG ASSIST ARCHIVE BYTES';
const FAKE_RELEASE_MODEL: MirrorModel = {
  id: 'fake-assist',
  kind: 'assist',
  upstreamUrl: 'https://upstream.example/asr-models/fake-assist.tar.bz2',
  sha256: sha256(FAKE_RELEASE_BYTES),
  bytes: FAKE_RELEASE_BYTES.length,
  displayName: 'Fake assist',
  release: { tag: 'models' },
};
const fakeDownloaderWithRelease: Downloader = async (url, dest) => {
  const id = url.split('/').pop()!.replace('.tar.bz2', '');
  writeFileSync(dest, id === 'fake-assist' ? FAKE_RELEASE_BYTES : FAKE_BYTES[id]!);
};

describe('MIRROR_MODELS data', () => {
  it('covers the six pinned archives (4 TTS + 1 ASR + 1 assist), unique ids + hashes', () => {
    expect(MIRROR_MODELS).toHaveLength(6);
    expect(MIRROR_MODELS.filter((m) => m.kind === 'tts-voice')).toHaveLength(4);
    expect(MIRROR_MODELS.filter((m) => m.kind === 'asr')).toHaveLength(1);
    expect(MIRROR_MODELS.filter((m) => m.kind === 'assist')).toHaveLength(1);
    expect(new Set(MIRROR_MODELS.map((m) => m.id)).size).toBe(6);
    expect(new Set(MIRROR_MODELS.map((m) => m.sha256)).size).toBe(6);
    for (const m of MIRROR_MODELS) {
      expect(m.sha256).toMatch(/^[a-f0-9]{64}$/);
      // Tree files must clear GitHub's 100 MB hard per-file limit; anything
      // bigger must be release-hosted (T59).
      if (m.bytes >= GITHUB_TREE_FILE_LIMIT) expect(m.release).toBeDefined();
      else expect(m.release).toBeUndefined();
    }
  });

  it('maps every model under models/{tts,asr,assist}/ keeping the upstream filename', () => {
    const dirs = { 'tts-voice': 'models/tts/', asr: 'models/asr/', assist: 'models/assist/' };
    for (const m of MIRROR_MODELS) {
      const rel = mirrorFilePath(m);
      expect(rel.startsWith(dirs[m.kind])).toBe(true);
      expect(rel.endsWith(m.upstreamUrl.split('/').pop()!)).toBe(true);
      expect(releaseAssetName(m)).toBe(m.upstreamUrl.split('/').pop());
    }
  });
});

describe('release-hosted models (T59)', () => {
  it('verifies, uploads once, writes a manifest entry with release {tag, asset}, no tree file', async () => {
    const content = makeContentRepo();
    const releases = fakeReleases();
    const summary = await runModelsMirror(content, {
      models: [...FAKE_MODELS, FAKE_RELEASE_MODEL],
      download: fakeDownloaderWithRelease,
      releases,
    });
    expect(summary.models.map((m) => m.action)).toEqual(['downloaded', 'downloaded', 'uploaded']);
    expect(releases.assets.get('models')).toEqual(['fake-assist.tar.bz2']);
    expect(releases.uploads).toEqual([FAKE_RELEASE_BYTES]);
    expect(existsSync(join(content, 'models/assist'))).toBe(false);

    const manifest = ModelsManifestSchema.parse(
      JSON.parse(readFileSync(join(content, MODELS_MANIFEST_FILE), 'utf8')),
    );
    const entry = manifest.models.find((m) => m.id === 'fake-assist')!;
    expect(entry.kind).toBe('assist');
    expect(entry.file).toBe('models/assist/fake-assist.tar.bz2');
    expect(entry.release).toEqual({ tag: 'models', asset: 'fake-assist.tar.bz2' });
    expect(manifest.models.find((m) => m.id === 'fake-voice')!.release).toBeUndefined();

    // Second run: asset present → 'released', nothing re-uploaded, nothing to commit.
    const again = await runModelsMirror(content, {
      models: [...FAKE_MODELS, FAKE_RELEASE_MODEL],
      download: fakeDownloaderWithRelease,
      releases,
    });
    expect(again.models.map((m) => m.action)).toEqual(['present', 'present', 'released']);
    expect(releases.uploads).toHaveLength(1);
    expect(again.outcome).toBe('unchanged');
  });

  it('refuses a bad hash before any upload', async () => {
    const content = makeContentRepo();
    const releases = fakeReleases();
    const badDownloader: Downloader = async (_url, dest) => writeFileSync(dest, 'wrong bytes');
    await expect(
      runModelsMirror(content, { models: [FAKE_RELEASE_MODEL], download: badDownloader, releases }),
    ).rejects.toThrow(/failed verification.*nothing was uploaded/s);
    expect(releases.uploads).toHaveLength(0);
    expect(releases.assets.size).toBe(0);
  });

  it('refuses an over-limit model that has no release tag', async () => {
    const content = makeContentRepo();
    const big: MirrorModel = { ...FAKE_MODELS[0]!, id: 'too-big', bytes: GITHUB_TREE_FILE_LIMIT };
    await expect(
      runModelsMirror(content, {
        models: [big],
        download: fakeDownloader,
        releases: fakeReleases(),
      }),
    ).rejects.toThrow(/over GitHub's 100 MB tree limit/);
  });
});

describe('runModelsMirror', () => {
  it('mirrors, emits a schema-valid manifest, and commits (green path)', async () => {
    const content = makeContentRepo();
    const summary = await runModelsMirror(content, {
      models: FAKE_MODELS,
      download: fakeDownloader,
    });

    expect(summary.outcome).toBe('committed');
    expect(summary.manifest).toBe('written');
    expect(summary.models.map((m) => m.action)).toEqual(['downloaded', 'downloaded']);
    expect(readFileSync(join(content, 'models/tts/fake-voice.tar.bz2'), 'utf8')).toBe(
      FAKE_BYTES['fake-voice'],
    );
    expect(readFileSync(join(content, 'models/asr/fake-asr.tar.bz2'), 'utf8')).toBe(
      FAKE_BYTES['fake-asr'],
    );

    const manifest = ModelsManifestSchema.parse(
      JSON.parse(readFileSync(join(content, MODELS_MANIFEST_FILE), 'utf8')),
    );
    expect(manifest.models.map((m) => m.id)).toEqual(['fake-voice', 'fake-asr']);
    expect(manifest.models[0]!.sha256).toBe(FAKE_MODELS[0]!.sha256);
    expect(manifest.models[0]!.meta?.upstreamUrl).toBe(FAKE_MODELS[0]!.upstreamUrl);
    expect(gitStatus(content)).toBe(''); // everything committed
  });

  it('is idempotent: a second run downloads nothing, changes nothing, commits nothing', async () => {
    const content = makeContentRepo();
    await runModelsMirror(content, { models: FAKE_MODELS, download: fakeDownloader });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: content,
      encoding: 'utf8',
    });
    const manifestBefore = readFileSync(join(content, MODELS_MANIFEST_FILE), 'utf8');

    let downloads = 0;
    const countingDownloader: Downloader = async (url, dest) => {
      downloads++;
      await fakeDownloader(url, dest);
    };
    const again = await runModelsMirror(content, {
      models: FAKE_MODELS,
      download: countingDownloader,
    });

    expect(downloads).toBe(0);
    expect(again.outcome).toBe('unchanged');
    expect(again.manifest).toBe('unchanged');
    expect(again.models.map((m) => m.action)).toEqual(['present', 'present']);
    expect(readFileSync(join(content, MODELS_MANIFEST_FILE), 'utf8')).toBe(manifestBefore);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: content, encoding: 'utf8' })).toBe(
      headBefore,
    );
  });

  it('refuses a downloaded archive whose hash mismatches, writing nothing into the repo', async () => {
    const content = makeContentRepo();
    const badDownloader: Downloader = async (_url, dest) => {
      writeFileSync(dest, 'not the pinned bytes');
    };
    await expect(
      runModelsMirror(content, { models: FAKE_MODELS, download: badDownloader }),
    ).rejects.toThrow(/failed verification against the pinned sha256.*nothing was written/s);
    expect(existsSync(join(content, 'models'))).toBe(false);
    expect(existsSync(join(content, MODELS_MANIFEST_FILE))).toBe(false);
    expect(gitStatus(content)).toBe('');
  });

  it('refuses to overwrite an existing mirrored file whose hash no longer matches', async () => {
    const content = makeContentRepo();
    await runModelsMirror(content, { models: FAKE_MODELS, download: fakeDownloader });
    // Corrupt one mirrored file, committed so the tree is clean.
    const abs = join(content, 'models/tts/fake-voice.tar.bz2');
    writeFileSync(abs, 'corrupt bytes');
    execFileSync('git', ['add', '.'], { cwd: content });
    execFileSync('git', ['commit', '-q', '-m', 'corrupt'], { cwd: content });

    await expect(
      runModelsMirror(content, { models: FAKE_MODELS, download: fakeDownloader }),
    ).rejects.toThrow(/sha256 does not match the pinned hash.*refusing to overwrite/s);
    // Never deleted, never replaced ("never delete, only add").
    expect(readFileSync(abs, 'utf8')).toBe('corrupt bytes');
  });

  it('refuses to run on a dirty repo', async () => {
    const content = makeContentRepo();
    writeFileSync(join(content, 'stray.txt'), 'x');
    await expect(
      runModelsMirror(content, { models: FAKE_MODELS, download: fakeDownloader }),
    ).rejects.toThrow(/uncommitted changes/);
  });

  it('refuses a directory that is not the content repo', async () => {
    const dir = tempDir();
    await expect(
      runModelsMirror(dir, { models: FAKE_MODELS, download: fakeDownloader }),
    ).rejects.toThrow(/does not look like the content repo/);
  });
});
