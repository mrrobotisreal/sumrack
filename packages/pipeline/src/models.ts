import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModelsManifestSchema,
  type ModelsManifest,
  type ModelsManifestEntry,
} from '@sumrak/schema';

/**
 * `pipeline models mirror` (T23, V2 §2): copy the exact speech-model archives
 * the app pins today from the public k2-fsa release assets into the private
 * `sumrak-content` repo (`models/{tts,asr}/`), and emit `models-manifest.json`
 * at the repo root. The app's catalogs then resolve model ids against that
 * manifest first, with the k2-fsa URLs kept as last-resort fallback.
 *
 * Discipline mirrors `publish`: every downloaded archive is sha256-verified
 * against the hash the app already pins BEFORE anything is written into the
 * repo; re-runs skip verified-present files (idempotent); the repo's model
 * files are never deleted or overwritten ("never delete, only add" — old
 * manifests and installs may reference them).
 *
 * T59: an archive over GitHub's 100 MB per-file limit (the Whisper assist
 * model) cannot live in the tree. Such a `MirrorModel` carries `release`
 * and is uploaded — after the same verification — as an asset of a GitHub
 * **Release** on the content repo (`gh release upload`, never clobbered);
 * its manifest entry points at the release (`release: {tag, asset}`) and
 * the app downloads the asset through the T23 resolver's `release` source.
 */

export interface MirrorModel {
  /** Stable id — MUST match the app catalog id (pin-tested from the app repo). */
  id: string;
  kind: 'tts-voice' | 'asr' | 'assist';
  /**
   * T59: present ⇒ the archive is a GitHub Release asset (tag) on the
   * content repo instead of a tree file. Required for archives ≥ 100 MB.
   */
  release?: { tag: string };
  /** The upstream k2-fsa release-asset URL the app currently pins. */
  upstreamUrl: string;
  /** The sha256 the app currently pins for that asset. */
  sha256: string;
  /** The byte size the app currently pins. */
  bytes: number;
  displayName: string;
}

const TTS_RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

/** The one Release on the content repo that carries over-limit model archives. */
export const MODELS_RELEASE_TAG = 'models';

function piperMirror(
  name: string,
  displayName: string,
  sha256: string,
  bytes: number,
): MirrorModel {
  return {
    id: `piper-ru-${name}`,
    kind: 'tts-voice',
    upstreamUrl: `${TTS_RELEASE_BASE}/vits-piper-ru_RU-${name}-medium.tar.bz2`,
    sha256,
    bytes,
    displayName,
  };
}

/**
 * The exact five archives pinned in the app catalogs as of T23
 * (`features/tts/catalog.ts` 2026-08-21, `features/pronunciation/asr-catalog.ts`
 * 2026-08-22). A test in the app repo pins that both sources claim the same
 * sha256 per model id — change either side only in lockstep.
 */
export const MIRROR_MODELS: readonly MirrorModel[] = [
  piperMirror(
    'ruslan',
    'Руслан',
    '0690b1cad01f86e8db9ba988af24898bdc1af774e23cb2e46b9c730269b6fd83',
    67_210_684,
  ),
  piperMirror(
    'irina',
    'Ирина',
    '1fc0f54e5e084fe287c07909f2f6e0ba6d857864cf800e3ab80286a4e8233008',
    67_153_308,
  ),
  piperMirror(
    'denis',
    'Денис',
    'efa4c18e0b5e32b81d1b6df36b9d312831e5d545200e27848ef926a4cd930300',
    67_190_991,
  ),
  piperMirror(
    'dmitri',
    'Дмитрий',
    'c86d0803737de13d441923ff3b3f309482fab8d7af3ec85949942809eb9a3660',
    67_188_551,
  ),
  {
    id: 'zipformer-ru-int8',
    kind: 'asr',
    upstreamUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2',
    sha256: 'd6a651569aacc9a177259fa54705dd76acae23f6a4d62ea6797bd220d4b57163',
    bytes: 60_239_942,
    displayName: 'Russian speech recognition',
  },
  /**
   * T59: the Whisper multilingual assist model pinned by the S25 benchmark
   * (`features/pronunciation/assist-catalog.ts` 2026-09-27). 207.6 MB —
   * over the tree limit, hence a Release asset under the `models` tag.
   */
  {
    id: 'whisper-base-int8',
    kind: 'assist',
    upstreamUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2',
    sha256: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de',
    bytes: 207_557_382,
    displayName: 'Assist model (English in «как сказать…»)',
    release: { tag: MODELS_RELEASE_TAG },
  },
] as const;

/** GitHub's hard per-file limit for files in the repo tree. */
export const GITHUB_TREE_FILE_LIMIT = 100 * 1024 * 1024;

const KIND_DIR: Record<MirrorModel['kind'], string> = {
  'tts-voice': 'tts',
  asr: 'asr',
  assist: 'assist',
};

/**
 * Repo-relative path an archive mirrors to: models/{tts,asr,assist}/<upstream
 * filename>. For release-hosted models this is the NOMINAL path the manifest
 * carries (the asset name is its basename) — nothing is written there.
 */
export function mirrorFilePath(model: MirrorModel): string {
  const fileName = model.upstreamUrl.split('/').pop()!;
  return `models/${KIND_DIR[model.kind]}/${fileName}`;
}

/** The asset name a release-hosted model uploads as. */
export function releaseAssetName(model: MirrorModel): string {
  return model.upstreamUrl.split('/').pop()!;
}

export const MODELS_MANIFEST_FILE = 'models-manifest.json';

export type Downloader = (url: string, destFile: string) => Promise<void>;

/**
 * Default downloader. Buffering a ~67 MB archive in host memory is fine —
 * only the DEVICE must stream (T11); the mirror runs on the Mac.
 */
export const fetchDownloader: Downloader = async (url, destFile) => {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download failed (HTTP ${res.status}) for ${url}`);
  }
  writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
};

/**
 * T59: the release-asset side of the mirror, behind a seam so tests never
 * touch GitHub. The default runs `gh` against the content repo's remote.
 */
export interface ReleaseStore {
  /** Asset names already attached to `tag` (empty when the release does not exist). */
  listAssets(tag: string): Promise<string[]>;
  /** Create the release (idempotent: a no-op when it exists). */
  ensureRelease(tag: string): Promise<void>;
  /** Attach `file` as `assetName` — must not clobber an existing asset. */
  upload(tag: string, file: string, assetName: string): Promise<void>;
}

function gh(repoDir: string, args: string[]): string {
  const res = spawnSync('gh', args, { cwd: repoDir, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${(res.stderr || res.stdout).slice(-800)}`);
  }
  return res.stdout;
}

export function ghReleaseStore(repoDir: string): ReleaseStore {
  return {
    async listAssets(tag) {
      const res = spawnSync('gh', ['release', 'view', tag, '--json', 'assets'], {
        cwd: repoDir,
        encoding: 'utf8',
      });
      if (res.status !== 0) {
        if (/release not found/i.test(res.stderr)) return [];
        throw new Error(`gh release view ${tag} failed:\n${res.stderr.slice(-800)}`);
      }
      const parsed = JSON.parse(res.stdout) as { assets?: { name: string }[] };
      return (parsed.assets ?? []).map((a) => a.name);
    },
    async ensureRelease(tag) {
      const res = spawnSync('gh', ['release', 'view', tag], { cwd: repoDir, encoding: 'utf8' });
      if (res.status === 0) return;
      gh(repoDir, [
        'release',
        'create',
        tag,
        '--title',
        'Speech model archives',
        '--notes',
        'Self-hosted speech-model archives over the 100 MB tree limit (T59). Managed by `pipeline models mirror` — never delete assets.',
      ]);
    },
    async upload(tag, file, assetName) {
      gh(repoDir, ['release', 'upload', tag, `${file}#${assetName}`]);
    },
  };
}

export interface MirrorOptions {
  push?: boolean;
  message?: string;
  /** Test seam; defaults to streaming fetch. */
  download?: Downloader;
  /** Test seam; defaults to the real pinned MIRROR_MODELS. */
  models?: readonly MirrorModel[];
  /** Test seam; defaults to `gh` against the content repo. */
  releases?: ReleaseStore;
}

export interface MirrorModelReport {
  id: string;
  file: string;
  /**
   * 'downloaded' = fetched + verified this run; 'present' = already mirrored +
   * verified; 'uploaded' = fetched, verified and attached to the release this
   * run; 'released' = already attached to the release.
   */
  action: 'downloaded' | 'present' | 'uploaded' | 'released';
  sha256: string;
  bytes: number;
}

export interface MirrorSummary {
  models: MirrorModelReport[];
  manifest: 'written' | 'unchanged';
  /** 'committed' when this run created a commit; 'unchanged' when nothing moved. */
  outcome: 'committed' | 'unchanged';
  committed?: string;
  pushed: boolean;
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function git(repoDir: string, args: string[]): string {
  const res = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${(res.stderr || res.stdout).slice(-800)}`);
  }
  return res.stdout;
}

export async function runModelsMirror(
  contentRepoDir: string,
  opts: MirrorOptions = {},
): Promise<MirrorSummary> {
  if (!existsSync(join(contentRepoDir, 'manifest.json'))) {
    throw new Error(`${contentRepoDir} does not look like the content repo (no manifest.json)`);
  }

  // Refuse to fold unrelated working-tree changes into the mirror commit
  // (same rule as publish).
  const dirty = git(contentRepoDir, ['status', '--porcelain']).trim();
  if (dirty !== '') {
    throw new Error(
      `content repo at ${contentRepoDir} has uncommitted changes — commit or stash them first:\n${dirty}`,
    );
  }

  const models = opts.models ?? MIRROR_MODELS;
  const download = opts.download ?? fetchDownloader;
  const releases = opts.releases ?? ghReleaseStore(contentRepoDir);
  const tmpDir = mkdtempSync(join(tmpdir(), 'sumrak-models-'));
  const reports: MirrorModelReport[] = [];
  const releaseAssets = new Map<string, string[]>();

  try {
    for (const model of models) {
      const relPath = mirrorFilePath(model);
      const target = join(contentRepoDir, relPath);

      if (model.release) {
        // T59: release-hosted. Same download + verify, then attach as an
        // asset; an asset already there is never replaced.
        const tag = model.release.tag;
        const assetName = releaseAssetName(model);
        if (!releaseAssets.has(tag)) releaseAssets.set(tag, await releases.listAssets(tag));
        if (releaseAssets.get(tag)!.includes(assetName)) {
          console.log(`= ${model.id}: already on release "${tag}" as ${assetName}`);
          reports.push({
            id: model.id,
            file: relPath,
            action: 'released',
            sha256: model.sha256,
            bytes: model.bytes,
          });
          continue;
        }
        console.log(`↓ ${model.id}: downloading ${model.upstreamUrl}`);
        const tmpFile = join(tmpDir, assetName);
        await download(model.upstreamUrl, tmpFile);
        const digest = sha256File(tmpFile);
        if (digest !== model.sha256) {
          throw new Error(
            `${model.id}: downloaded archive failed verification against the pinned sha256 ` +
              `(got ${digest}) — nothing was uploaded`,
          );
        }
        await releases.ensureRelease(tag);
        await releases.upload(tag, tmpFile, assetName);
        releaseAssets.get(tag)!.push(assetName);
        console.log(`✓ ${model.id}: verified, uploaded to release "${tag}" as ${assetName}`);
        reports.push({
          id: model.id,
          file: relPath,
          action: 'uploaded',
          sha256: digest,
          bytes: model.bytes,
        });
        continue;
      }

      if (model.bytes >= GITHUB_TREE_FILE_LIMIT) {
        throw new Error(
          `${model.id} is ${model.bytes} bytes — over GitHub's 100 MB tree limit; give it a \`release\` tag`,
        );
      }

      if (existsSync(target)) {
        // Never overwrite: an existing file must already be the pinned bytes.
        const digest = sha256File(target);
        if (digest !== model.sha256) {
          throw new Error(
            `${relPath} exists but its sha256 does not match the pinned hash for ${model.id} — ` +
              `refusing to overwrite (model files are never deleted or replaced; investigate manually)`,
          );
        }
        console.log(`= ${model.id}: already mirrored + verified (${relPath})`);
        reports.push({
          id: model.id,
          file: relPath,
          action: 'present',
          sha256: digest,
          bytes: model.bytes,
        });
        continue;
      }

      // Download to a temp file OUTSIDE the repo and verify the pinned hash
      // before any write lands inside it.
      console.log(`↓ ${model.id}: downloading ${model.upstreamUrl}`);
      const tmpFile = join(tmpDir, `${model.id}.tar.bz2`);
      await download(model.upstreamUrl, tmpFile);
      const digest = sha256File(tmpFile);
      if (digest !== model.sha256) {
        throw new Error(
          `${model.id}: downloaded archive failed verification against the pinned sha256 ` +
            `(got ${digest}) — nothing was written into the repo`,
        );
      }
      mkdirSync(join(target, '..'), { recursive: true });
      renameSync(tmpFile, target);
      console.log(`✓ ${model.id}: verified against pinned sha256, mirrored to ${relPath}`);
      reports.push({
        id: model.id,
        file: relPath,
        action: 'downloaded',
        sha256: digest,
        bytes: model.bytes,
      });
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Emit models-manifest.json (schema-validated backstop before writing).
  // Idempotent: only rewrite when the model list itself changed, so re-runs
  // don't churn generatedAt into a meaningless commit.
  const entries: ModelsManifestEntry[] = models.map((model) => ({
    id: model.id,
    kind: model.kind,
    file: mirrorFilePath(model),
    bytes: model.bytes,
    sha256: model.sha256,
    displayName: model.displayName,
    meta: { upstreamUrl: model.upstreamUrl },
    ...(model.release
      ? { release: { tag: model.release.tag, asset: releaseAssetName(model) } }
      : {}),
  }));
  const manifestFile = join(contentRepoDir, MODELS_MANIFEST_FILE);
  let manifestAction: 'written' | 'unchanged' = 'written';
  if (existsSync(manifestFile)) {
    const existing = ModelsManifestSchema.safeParse(JSON.parse(readFileSync(manifestFile, 'utf8')));
    if (existing.success && JSON.stringify(existing.data.models) === JSON.stringify(entries)) {
      manifestAction = 'unchanged';
    }
  }
  if (manifestAction === 'written') {
    const manifest: ModelsManifest = ModelsManifestSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      models: entries,
    });
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  // Commit only when something actually changed. (`models/` may not exist
  // when every model is release-hosted — add it only if present.)
  git(contentRepoDir, [
    'add',
    ...(existsSync(join(contentRepoDir, 'models')) ? ['models'] : []),
    MODELS_MANIFEST_FILE,
  ]);
  const staged = git(contentRepoDir, ['status', '--porcelain']).trim();
  if (staged === '') {
    return { models: reports, manifest: manifestAction, outcome: 'unchanged', pushed: false };
  }
  const message = opts.message ?? 'Mirror speech models from k2-fsa (T23)';
  git(contentRepoDir, ['commit', '-m', message]);
  const committed = git(contentRepoDir, ['rev-parse', '--short', 'HEAD']).trim();
  if (opts.push) git(contentRepoDir, ['push']);

  return {
    models: reports,
    manifest: manifestAction,
    outcome: 'committed',
    committed,
    pushed: opts.push === true,
  };
}
