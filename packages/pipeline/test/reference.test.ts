import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPublish, runValidate } from '../src/index.ts';

/**
 * T38: `reference` packs are hand-assembled JSON (no annotate) — validate
 * accepts them and publish ships pack.json only with `type: reference`.
 */

const fixtureDir = join(
  __dirname,
  '..',
  '..',
  'schema',
  'fixtures',
  'packs',
  'core-lemmas-fixture',
);

describe('reference pack (T38)', () => {
  it('validates the fixture', () => {
    const result = runValidate(join(fixtureDir, 'pack.json'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.lemmaLists).toHaveLength(2);
  });

  it('publishes against a scratch content repo: pack.json only, type reference, no category', () => {
    const dir = mkdtempSync(join(tmpdir(), 't38-publish-'));
    try {
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'T38 Test');
      writeFileSync(
        join(dir, 'manifest.json'),
        `${JSON.stringify({ schemaVersion: 1, packs: [] })}\n`,
      );
      git('add', 'manifest.json');
      git('commit', '-qm', 'init');

      const summary = runPublish(fixtureDir, dir);
      expect(summary.outcome).toBe('published');
      expect(summary.files.map((f) => f.path)).toEqual(['pack.json']);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(manifest.packs[0]).toMatchObject({
        id: 'core-lemmas-fixture',
        version: 1,
        type: 'reference',
        level: 'A1',
      });
      expect(manifest.packs[0].category).toBeUndefined();
      expect(runPublish(fixtureDir, dir).outcome).toBe('unchanged');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
