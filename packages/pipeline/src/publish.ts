import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ManifestSchema,
  safeParsePack,
  type Manifest,
  type ManifestEntry,
  type Pack,
} from '@sumrak/schema';

/**
 * `pipeline publish` (T09, design §8 step 4): put a finished pack dir into
 * the `sumrak-content` repo — copy files, recompute sha256 hashes + byte
 * sizes, update `manifest.json`, and commit (push only with `--push`).
 *
 * Version discipline: a pack with changed content but an unbumped version is
 * refused (installed apps diff manifest *versions*, not hashes, to decide
 * updates — same-version drift would never reach devices). Re-publishing
 * identical content at the same version is a clean no-op.
 */

export interface PublishOptions {
  push?: boolean;
  message?: string;
}

export interface PublishSummary {
  packId: string;
  version: number;
  files: { path: string; bytes: number; sha256: string }[];
  totalBytes: number;
  /** "published" | "unchanged" (no-op at the same version and hashes). */
  outcome: 'published' | 'unchanged';
  committed?: string;
  pushed: boolean;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function git(repoDir: string, args: string[]): string {
  const res = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${(res.stderr || res.stdout).slice(-800)}`);
  }
  return res.stdout;
}

/** The relative paths a pack ships: pack.json + every referenced audio file. */
export function packFileList(pack: Pack): string[] {
  const files = ['pack.json'];
  for (const story of pack.stories) {
    for (const track of story.audio) files.push(track.file);
  }
  // Dialogue node + choice coach audio (T26).
  for (const dialogue of pack.dialogues ?? []) {
    for (const node of dialogue.nodes) {
      if (node.audio) files.push(node.audio.file);
      for (const choice of node.choices ?? []) {
        if (choice.audio) files.push(choice.audio.file);
      }
    }
  }
  return files;
}

export function runPublish(
  packDir: string,
  contentRepoDir: string,
  opts: PublishOptions = {},
): PublishSummary {
  // 1. Validate the pack (reuses the shared schema — the T08 validate gate).
  const packFile = join(packDir, 'pack.json');
  if (!existsSync(packFile))
    throw new Error(`${packFile} does not exist — run pipeline audio/annotate first`);
  const parsed = safeParsePack(JSON.parse(readFileSync(packFile, 'utf8')));
  if (!parsed.success) {
    const details = parsed.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`${packFile} is not a valid pack:\n${details}`);
  }
  const pack = parsed.data;

  // 2. Collect + hash the pack's files from the source dir.
  const relPaths = packFileList(pack);
  const files = relPaths.map((rel) => {
    const abs = join(packDir, rel);
    if (!existsSync(abs))
      throw new Error(`pack references missing file: ${rel} (looked at ${abs})`);
    const buf = readFileSync(abs);
    return { path: rel, bytes: buf.byteLength, sha256: sha256Hex(buf) };
  });
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);

  // 3. Manifest + version discipline.
  const manifestFile = join(contentRepoDir, 'manifest.json');
  if (!existsSync(manifestFile))
    throw new Error(`${manifestFile} does not exist — is this the content repo?`);
  const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')));
  const existing = manifest.packs.find((p) => p.id === pack.id);
  if (existing) {
    if (existing.version > pack.version) {
      throw new Error(
        `manifest already has ${pack.id} v${existing.version}; refusing to publish older v${pack.version}`,
      );
    }
    if (existing.version === pack.version) {
      const sameFiles =
        existing.files.length === files.length &&
        existing.files.every((mf) =>
          files.some((f) => f.path === mf.path && f.sha256 === mf.sha256),
        );
      if (sameFiles) {
        return {
          packId: pack.id,
          version: pack.version,
          files,
          totalBytes,
          outcome: 'unchanged',
          pushed: false,
        };
      }
      throw new Error(
        `${pack.id} v${pack.version} is already published with different content — bump the pack version in the draft frontmatter (installed apps only re-download on version bumps)`,
      );
    }
  }

  // 4. Refuse to fold unrelated working-tree changes into the publish commit.
  const dirty = git(contentRepoDir, ['status', '--porcelain']).trim();
  if (dirty !== '') {
    throw new Error(
      `content repo at ${contentRepoDir} has uncommitted changes — commit or stash them first:\n${dirty}`,
    );
  }

  // 5. Copy the pack dir (replace wholesale so stale files can't linger).
  const targetDir = join(contentRepoDir, 'packs', pack.id);
  rmSync(targetDir, { recursive: true, force: true });
  for (const f of files) {
    const dest = join(targetDir, f.path);
    mkdirSync(join(dest, '..'), { recursive: true });
    cpSync(join(packDir, f.path), dest);
  }

  // 6. Update the manifest entry (replace in place, append when new).
  const entry: ManifestEntry = {
    id: pack.id,
    version: pack.version,
    type: pack.type,
    level: pack.level,
    title: pack.title,
    // M14 §2.3: mirror the pack's category; the key is absent otherwise.
    ...(pack.category ? { category: pack.category } : {}),
    bytes: totalBytes,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  const idx = manifest.packs.findIndex((p) => p.id === pack.id);
  if (idx === -1) manifest.packs.push(entry);
  else manifest.packs[idx] = entry;
  manifest.generatedAt = new Date().toISOString();
  const validated = ManifestSchema.parse(manifest); // backstop before writing
  writeFileSync(manifestFile, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');

  // 7. Commit (and push only when asked — the content repo is the one place
  // T09 expects a push, but it stays an explicit flag).
  git(contentRepoDir, ['add', join('packs', pack.id), 'manifest.json']);
  const message = opts.message ?? `Publish ${pack.id} v${pack.version}`;
  git(contentRepoDir, ['commit', '-m', message]);
  const committed = git(contentRepoDir, ['rev-parse', '--short', 'HEAD']).trim();
  if (opts.push) git(contentRepoDir, ['push']);

  return {
    packId: pack.id,
    version: pack.version,
    files,
    totalBytes,
    outcome: 'published',
    committed,
    pushed: opts.push === true,
  };
}
