import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { firstJsonDiff, packFileList, runPublish } from '../src/publish.ts';
import { runStitch } from '../src/stitch.ts';

/** T94 `publish --stitch-only` against throwaway git content repos. */

const FIXTURE = join(__dirname, '..', '..', 'schema', 'fixtures', 'packs', 'a1-listen-fixture');
const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

const tempDirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sumrak-t94p-'));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function makeContentRepo(): string {
  const dir = tempDir();
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't94@test');
  git('config', 'user.name', 'T94 Test');
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, packs: [] })}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/** A fixture copy with fullStory/cover stripped = the "v1 already published" state. */
function publishedV1(): { content: string; packDir: string } {
  const packDir = join(tempDir(), 'p');
  cpSync(FIXTURE, packDir, { recursive: true });
  const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
  delete pack.fullStory;
  writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  rmSync(join(packDir, 'audio', 'a1-listen-fixture-full.opus'), { force: true });
  const content = makeContentRepo();
  runPublish(packDir, content);
  return { content, packDir };
}

describe('firstJsonDiff', () => {
  it('is key-order independent and names the first differing path', () => {
    expect(firstJsonDiff({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBeUndefined();
    expect(firstJsonDiff({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe('$.a.b[1]');
    expect(firstJsonDiff({ a: 1 }, { a: 1, c: 2 })).toBe('$.c');
  });
});

describe('packFileList (T94)', () => {
  it('includes the full-story track and the cover', () => {
    const pack = JSON.parse(readFileSync(join(FIXTURE, 'pack.json'), 'utf8'));
    pack.cover = 'cover/cover.jpg';
    const list = packFileList(pack);
    expect(list).toContain('audio/a1-listen-fixture-full.opus');
    expect(list).toContain('cover/cover.jpg');
  });
});

describe.skipIf(!hasFfmpeg)('runPublish --stitch-only', () => {
  it('passes when only fullStory/version differ; reports fullStoryBytes; no audit needed', () => {
    const { content, packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    const summary = runPublish(packDir, content, { stitchOnly: true });
    expect(summary.outcome).toBe('published');
    expect(summary.version).toBe(2);
    expect(summary.fullStoryBytes).toBeGreaterThan(0);
    expect(summary.stitchOnlyNote).toBe(
      'stitch-only: 3 tracks byte-identical, stamp-audit skipped',
    );
    const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8'));
    expect(manifest.packs[0].files.map((f: { path: string }) => f.path)).toContain(
      'audio/a1-listen-fixture-full.opus',
    );
  });

  it('fails on a changed token', () => {
    const { content, packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    pack.stories[0].sentences[0].tokens[0].translation = 'me';
    writeFileSync(join(packDir, 'pack.json'), JSON.stringify(pack, null, 2));
    expect(() => runPublish(packDir, content, { stitchOnly: true })).toThrow(
      /differs from the published .* at \$\.stories\[0\]\.sentences\[0\]\.tokens\[0\]\.translation/,
    );
  });

  it('fails on a changed audio byte', () => {
    const { content, packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    const f = join(packDir, 'audio', 'lf-p2.opus');
    const buf = readFileSync(f);
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    writeFileSync(f, buf);
    expect(() => runPublish(packDir, content, { stitchOnly: true })).toThrow(/lf-p2\.opus differs/);
  });

  it('fails on a missing part', () => {
    const { content, packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    rmSync(join(packDir, 'audio', 'lf-p3.opus'));
    expect(() => runPublish(packDir, content, { stitchOnly: true })).toThrow(/lf-p3\.opus/);
  });

  it('fails on an unpublished pack', () => {
    const { packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    expect(() => runPublish(packDir, makeContentRepo(), { stitchOnly: true })).toThrow(
      /not published yet/,
    );
  });

  it('refuses to combine with the stamp-audit flags', () => {
    const { content, packDir } = publishedV1();
    runStitch(packDir, { bump: true });
    expect(() => runPublish(packDir, content, { stitchOnly: true, allowStampRisk: true })).toThrow(
      /cannot be combined/,
    );
  });
});
