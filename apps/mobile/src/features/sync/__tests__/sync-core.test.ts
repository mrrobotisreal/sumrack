import { createHash } from 'node:crypto';
import type { Manifest, ManifestEntry } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import type { SyncStateRow } from '@/db/repositories/sync-state';

import { SyncError } from '../errors';
import {
  diffManifest,
  formatBytes,
  isAudioFile,
  planPackFiles,
  verifyFileSha256,
  type Hasher,
} from '../sync-core';

const nodeHasher: Hasher = async (bytes) => createHash('sha256').update(bytes).digest('hex');

function entry(id: string, version: number, files?: ManifestEntry['files']): ManifestEntry {
  return {
    id,
    version,
    type: 'stories',
    level: 'A1',
    title: { ru: id, en: id },
    bytes: 1000,
    files: files ?? [{ path: 'pack.json', sha256: 'a'.repeat(64) }],
  };
}

function manifest(...packs: ManifestEntry[]): Manifest {
  return { schemaVersion: 1, packs };
}

function installedRow(packId: string, version: number, source = 'github'): SyncStateRow {
  return { packId, version, source, installedAt: 1, updatedAt: 1, bytes: null };
}

describe('diffManifest', () => {
  it('classifies new, updated, and up-to-date packs', () => {
    const diff = diffManifest(
      manifest(entry('new-pack', 1), entry('updated-pack', 3), entry('same-pack', 2)),
      [installedRow('updated-pack', 2), installedRow('same-pack', 2)],
    );
    expect(diff.toInstall.map((p) => p.id)).toEqual(['new-pack']);
    expect(diff.toUpdate.map((p) => p.id)).toEqual(['updated-pack']);
    expect(diff.upToDate.map((p) => p.id)).toEqual(['same-pack']);
    expect(diff.removedRemotely).toEqual([]);
  });

  it('treats a manifest entry older than installed as up-to-date (importer refuses downgrades)', () => {
    const diff = diffManifest(manifest(entry('pack-a', 1)), [installedRow('pack-a', 5)]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.upToDate.map((p) => p.id)).toEqual(['pack-a']);
  });

  it('reports github-sourced installed packs missing from the manifest, never bundled ones', () => {
    const diff = diffManifest(manifest(entry('kept', 1)), [
      installedRow('kept', 1),
      installedRow('gone-github', 1, 'github'),
      installedRow('gone-bundled', 1, 'bundled'),
    ]);
    expect(diff.removedRemotely.map((r) => r.packId)).toEqual(['gone-github']);
  });
});

describe('planPackFiles', () => {
  const packWithAudio = entry('pack-a', 1, [
    { path: 'pack.json', sha256: 'a'.repeat(64) },
    { path: 'audio/story1.opus', sha256: 'b'.repeat(64) },
    { path: 'audio/story2.opus', sha256: 'c'.repeat(64) },
  ]);

  it('downloads everything when on Wi-Fi', () => {
    const plan = planPackFiles(packWithAudio, { wifiOnlyAudio: true, onWifi: true });
    expect(plan.packJson.path).toBe('pack.json');
    expect(plan.audio.map((f) => f.path)).toEqual(['audio/story1.opus', 'audio/story2.opus']);
    expect(plan.deferredAudio).toEqual([]);
  });

  it('defers audio — never pack.json — on cellular with Wi-Fi-only on', () => {
    const plan = planPackFiles(packWithAudio, { wifiOnlyAudio: true, onWifi: false });
    expect(plan.packJson.path).toBe('pack.json');
    expect(plan.audio).toEqual([]);
    expect(plan.deferredAudio.map((f) => f.path)).toEqual([
      'audio/story1.opus',
      'audio/story2.opus',
    ]);
  });

  it('downloads audio on cellular when the toggle is off', () => {
    const plan = planPackFiles(packWithAudio, { wifiOnlyAudio: false, onWifi: false });
    expect(plan.audio.length).toBe(2);
    expect(plan.deferredAudio).toEqual([]);
  });

  it('ignores unknown non-audio files (forward compatibility)', () => {
    const withExtra = entry('pack-a', 1, [
      { path: 'pack.json', sha256: 'a'.repeat(64) },
      { path: 'cover.webp', sha256: 'd'.repeat(64) },
    ]);
    const plan = planPackFiles(withExtra, { wifiOnlyAudio: false, onWifi: true });
    expect(plan.audio).toEqual([]);
    expect(plan.deferredAudio).toEqual([]);
  });

  it('throws invalid-manifest when pack.json is missing from the entry', () => {
    const broken = {
      ...entry('pack-a', 1),
      files: [{ path: 'audio/x.opus', sha256: 'a'.repeat(64) }],
    };
    expect(() => planPackFiles(broken, { wifiOnlyAudio: false, onWifi: true })).toThrowError(
      SyncError,
    );
  });
});

describe('verifyFileSha256', () => {
  const bytes = new TextEncoder().encode('привет, Сумрак');

  it('passes when the hash matches', async () => {
    const expected = createHash('sha256').update(bytes).digest('hex');
    await expect(
      verifyFileSha256(bytes, expected, 'pack.json', nodeHasher),
    ).resolves.toBeUndefined();
  });

  it('accepts uppercase manifest hashes', async () => {
    const expected = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    await expect(
      verifyFileSha256(bytes, expected, 'pack.json', nodeHasher),
    ).resolves.toBeUndefined();
  });

  it('throws sha256-mismatch on corrupted bytes, naming the file', async () => {
    const expected = createHash('sha256').update(bytes).digest('hex');
    const corrupted = new Uint8Array([...bytes, 0x00]);
    const err = await verifyFileSha256(corrupted, expected, 'audio/story1.opus', nodeHasher).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).code).toBe('sha256-mismatch');
    expect((err as SyncError).path).toBe('audio/story1.opus');
  });
});

describe('isAudioFile', () => {
  it.each([
    ['audio/story1.opus', true],
    ['audio/nested/track.mp3', true],
    ['story.OPUS', true],
    ['pack.json', false],
    ['cover.webp', false],
  ])('%s → %s', (path, expected) => {
    expect(isAudioFile(path)).toBe(expected);
  });
});

describe('formatBytes', () => {
  it.each([
    [null, '—'],
    [0, '—'],
    [512, '512 B'],
    [37776, '36.9 KB'],
    [4_400_000, '4.2 MB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
