import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { auditPack, formatAuditTable } from './stamp-audit.ts';
import type { Aligner } from './stamp-audit.ts';
import {
  ManifestSchema,
  safeParsePack,
  scenarioLines,
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
  /**
   * T80 gate: audit every timestamped story track against its audio and
   * refuse on failure. The CLI always passes one; library callers (tests)
   * omit it to skip the audit.
   */
  stampAudit?: Aligner;
  /** Publish despite a failing stamp audit; the override is logged to `<packDir>/BUILD_NOTES.md`. */
  allowStampRisk?: boolean;
  /**
   * T94 fast path: republish a pack whose story audio is byte-identical to the
   * published one and whose only other differences are `fullStory`/`cover`/
   * `version`. Skips the stamp-audit. Incompatible with `stampAudit` and
   * `allowStampRisk` (those are errors, not silently ignored).
   */
  stitchOnly?: boolean;
}

export interface PublishSummary {
  packId: string;
  version: number;
  files: { path: string; bytes: number; sha256: string }[];
  totalBytes: number;
  /** Bytes under `scene/` (PNG layers, T57) — reported separately: they are the Wi-Fi-gated bulk. */
  sceneBytes: number;
  /** Bytes of the stitched full-story track (T94); 0 when the pack has none. */
  fullStoryBytes: number;
  /** Set by `--stitch-only`: the «N tracks byte-identical, stamp-audit skipped» log line. */
  stitchOnlyNote?: string;
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

/** Directory of PNG layers a scenario pack may ship (any depth). */
export const SCENE_DIR = 'scene';

/**
 * The relative paths a pack ships: pack.json + every referenced audio file
 * (+ for scenario packs, every line's audio, every coach file and — when
 * `packDir` is given — every file under `scene/`, T57).
 */
export function packFileList(pack: Pack, packDir?: string): string[] {
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
  // Scenario line audio + coach audio (T57).
  for (const scenario of pack.scenarios ?? []) {
    for (const ref of scenarioLines(scenario)) {
      if (ref.line.audio) files.push(ref.line.audio.file);
    }
    for (const turn of scenario.turns) {
      if (turn.expect?.coachAudio) files.push(turn.expect.coachAudio.file);
    }
  }
  // scene/** — PNG layers referenced by portraits/backdrop; shipped wholesale
  // (the pack dir is the source of truth for what art exists).
  if (packDir !== undefined && (pack.scenarios?.length ?? 0) > 0) {
    files.push(...sceneFiles(packDir));
  }
  // M26 (T94): the stitched full-story track and the cover ship like any file.
  if (pack.fullStory) files.push(pack.fullStory.file);
  if (pack.cover) files.push(pack.cover);
  return files;
}

/** Pack keys a stitch-only republish may change. */
const STITCH_ONLY_KEYS = ['fullStory', 'cover', 'version'] as const;

/** Key-order-independent JSON structural diff: the first differing path, or undefined. */
export function firstJsonDiff(a: unknown, b: unknown, path = '$'): string | undefined {
  if (a === b) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = firstJsonDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort()) {
      const d = firstJsonDiff(ra[k], rb[k], `${path}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return path;
}

function withoutStitchKeys(pack: object): Record<string, unknown> {
  const copy = { ...(pack as Record<string, unknown>) };
  for (const k of STITCH_ONLY_KEYS) delete copy[k];
  return copy;
}

/**
 * T94 `--stitch-only` guard: the pack must differ from the published one only
 * in {fullStory, cover, version}, and every story track must hash as the
 * published manifest lists it. Throws naming the first differing path / file.
 * Returns the number of byte-identical story tracks.
 */
function assertStitchOnly(
  pack: Pack,
  packDir: string,
  contentRepoDir: string,
  existing: ManifestEntry | undefined,
): number {
  if (!existing)
    throw new Error(`--stitch-only: ${pack.id} is not published yet — publish it normally first`);
  const publishedFile = join(contentRepoDir, 'packs', pack.id, 'pack.json');
  if (!existsSync(publishedFile)) {
    throw new Error(`--stitch-only: ${publishedFile} does not exist`);
  }
  const published = JSON.parse(readFileSync(publishedFile, 'utf8')) as object;
  const diff = firstJsonDiff(withoutStitchKeys(pack), withoutStitchKeys(published));
  if (diff) {
    throw new Error(`--stitch-only: pack differs from the published ${pack.id} at ${diff}`);
  }
  let tracks = 0;
  for (const story of pack.stories) {
    for (const track of story.audio) {
      const listed = existing.files.find((f) => f.path === track.file);
      if (!listed)
        throw new Error(`--stitch-only: ${track.file} is not in the published manifest entry`);
      const abs = join(packDir, track.file);
      if (!existsSync(abs)) throw new Error(`--stitch-only: audio file missing: ${track.file}`);
      if (sha256Hex(readFileSync(abs)) !== listed.sha256) {
        throw new Error(`--stitch-only: ${track.file} differs from the published audio (sha256)`);
      }
      tracks++;
    }
  }
  return tracks;
}

/** Every regular file under `<packDir>/scene/`, as pack-relative POSIX paths, sorted. */
export function sceneFiles(packDir: string): string[] {
  const root = join(packDir, SCENE_DIR);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && !entry.name.startsWith('.')) {
        out.push(relative(packDir, abs).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
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

  if (opts.stitchOnly && (opts.stampAudit || opts.allowStampRisk)) {
    throw new Error(
      '--stitch-only cannot be combined with a stamp-audit or --allow-stamp-risk (it skips the audit only for byte-identical tracks)',
    );
  }

  // 1b. T80 stamp-accuracy gate: stamps must match the audio they ship with.
  if (opts.stampAudit) {
    const audit = auditPack(pack, packDir, opts.stampAudit);
    if (!audit.ok) {
      const table = formatAuditTable(audit);
      if (!opts.allowStampRisk) {
        throw new Error(
          `stamp audit FAILED for ${pack.id} — fix with \`pipeline restamp\`, or override with --allow-stamp-risk:\n${table}`,
        );
      }
      appendFileSync(
        join(packDir, 'BUILD_NOTES.md'),
        `\n## ${new Date().toISOString()} — published ${pack.id} v${pack.version} with --allow-stamp-risk\n\n\`\`\`\n${table}\n\`\`\`\n`,
      );
    }
  }

  // 2. Collect + hash the pack's files from the source dir.
  const relPaths = packFileList(pack, packDir);
  const files = relPaths.map((rel) => {
    const abs = join(packDir, rel);
    if (!existsSync(abs))
      throw new Error(`pack references missing file: ${rel} (looked at ${abs})`);
    const buf = readFileSync(abs);
    return { path: rel, bytes: buf.byteLength, sha256: sha256Hex(buf) };
  });
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const sceneBytes = files
    .filter((f) => f.path.startsWith(`${SCENE_DIR}/`))
    .reduce((n, f) => n + f.bytes, 0);
  const fullStoryBytes = pack.fullStory
    ? (files.find((f) => f.path === pack.fullStory!.file)?.bytes ?? 0)
    : 0;

  // 3. Manifest + version discipline.
  const manifestFile = join(contentRepoDir, 'manifest.json');
  if (!existsSync(manifestFile))
    throw new Error(`${manifestFile} does not exist — is this the content repo?`);
  const manifest: Manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')));
  const existing = manifest.packs.find((p) => p.id === pack.id);
  let stitchOnlyNote: string | undefined;
  if (opts.stitchOnly) {
    const n = assertStitchOnly(pack, packDir, contentRepoDir, existing);
    stitchOnlyNote = `stitch-only: ${n} tracks byte-identical, stamp-audit skipped`;
  }
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
          sceneBytes,
          fullStoryBytes,
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
    sceneBytes,
    fullStoryBytes,
    ...(stitchOnlyNote ? { stitchOnlyNote } : {}),
    outcome: 'published',
    committed,
    pushed: opts.push === true,
  };
}
