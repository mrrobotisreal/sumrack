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
 */

export interface MirrorModel {
  /** Stable id — MUST match the app catalog id (pin-tested from the app repo). */
  id: string;
  kind: 'tts-voice' | 'asr';
  /** The upstream k2-fsa release-asset URL the app currently pins. */
  upstreamUrl: string;
  /** The sha256 the app currently pins for that asset. */
  sha256: string;
  /** The byte size the app currently pins. */
  bytes: number;
  displayName: string;
}

const TTS_RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

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
] as const;

/** Repo-relative path an archive mirrors to: models/{tts,asr}/<upstream filename>. */
export function mirrorFilePath(model: MirrorModel): string {
  const fileName = model.upstreamUrl.split('/').pop()!;
  return `models/${model.kind === 'tts-voice' ? 'tts' : 'asr'}/${fileName}`;
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

export interface MirrorOptions {
  push?: boolean;
  message?: string;
  /** Test seam; defaults to streaming fetch. */
  download?: Downloader;
  /** Test seam; defaults to the real pinned MIRROR_MODELS. */
  models?: readonly MirrorModel[];
}

export interface MirrorModelReport {
  id: string;
  file: string;
  /** 'downloaded' = fetched + verified this run; 'present' = already mirrored + verified. */
  action: 'downloaded' | 'present';
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
  const tmpDir = mkdtempSync(join(tmpdir(), 'sumrak-models-'));
  const reports: MirrorModelReport[] = [];

  try {
    for (const model of models) {
      const relPath = mirrorFilePath(model);
      const target = join(contentRepoDir, relPath);

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

  // Commit only when something actually changed.
  git(contentRepoDir, ['add', 'models', MODELS_MANIFEST_FILE]);
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
