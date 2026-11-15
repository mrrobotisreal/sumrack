import type { Pack } from '@sumrak/schema';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import listenJson from '@sumrak/schema/fixtures/packs/a1-listen-fixture/pack.json';

import journal from '../../../drizzle/meta/_journal.json';
import { fetchOrReuseFile, planPackFiles, type Hasher } from '../../features/sync/sync-core';
import { importPack } from '../importer';
import { createContentRepo } from '../repositories/content';
import { createListenRepo } from '../repositories/listen';
import { createTestDb } from './helpers';

/** T115: story scores through migration 0024 → importer → repos → sync reuse. */

const listenPack = listenJson as unknown as Pack;

/** The listen fixture with part-1 and part-3 scored (part-2 unscored). */
function scoredPack(version = 1): Pack {
  const pack: Pack = JSON.parse(JSON.stringify(listenPack));
  pack.version = version;
  pack.stories[0]!.score = {
    id: 'lf-p1-score',
    file: 'audio/lf-p1-score.opus',
    durationMs: pack.stories[0]!.audio[0]!.durationMs,
    trackId: 'lf-p1',
  };
  pack.stories[2]!.score = {
    id: 'lf-p3-score',
    file: 'audio/lf-p3-score.opus',
    durationMs: pack.stories[2]!.audio[0]!.durationMs + 10,
    trackId: 'lf-p3',
  };
  return pack;
}

describe('0024_story-scores', () => {
  it('fresh DB has story_scores with the expected columns; journal idx 24', async () => {
    const db = createTestDb();
    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(story_scores)`);
    expect(cols.map((c) => c.name)).toEqual([
      'pack_id',
      'story_id',
      'id',
      'track_id',
      'file',
      'local_uri',
      'duration_ms',
    ]);
    expect(journal.entries.find((e) => e.tag === '0024_story-scores')).toMatchObject({ idx: 24 });
  });

  it('deleting a pack cascades its score rows', async () => {
    const db = createTestDb();
    await importPack(db, scoredPack());
    await db.run(sql`DELETE FROM packs WHERE id = 'a1-listen-fixture'`);
    const n = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM story_scores`);
    expect(n[0]!.n).toBe(0);
  });
});

describe('importer + repos (T115)', () => {
  it('writes one row per scored story; local_uri from audioFiles, else NULL', async () => {
    const db = createTestDb();
    await importPack(db, scoredPack(), {
      audioFiles: { 'audio/lf-p1-score.opus': 'file:///p/lf-p1-score.opus' },
    });
    const rows = await db.all<Record<string, unknown>>(
      sql`SELECT * FROM story_scores ORDER BY story_id`,
    );
    expect(rows).toEqual([
      {
        pack_id: 'a1-listen-fixture',
        story_id: 'part-1',
        id: 'lf-p1-score',
        track_id: 'lf-p1',
        file: 'audio/lf-p1-score.opus',
        local_uri: 'file:///p/lf-p1-score.opus',
        duration_ms: 1206,
      },
      {
        pack_id: 'a1-listen-fixture',
        story_id: 'part-3',
        id: 'lf-p3-score',
        track_id: 'lf-p3',
        file: 'audio/lf-p3-score.opus',
        local_uri: null,
        duration_ms: 1416,
      },
    ]);
  });

  it('a version bump without scores drops them; an unscored pack has none', async () => {
    const db = createTestDb();
    await importPack(db, scoredPack(1));
    await importPack(db, { ...JSON.parse(JSON.stringify(listenPack)), version: 2 });
    const n = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM story_scores`);
    expect(n[0]!.n).toBe(0);
  });

  it('getStoryDetail carries the score (null when unscored); set/list/count for the backfill', async () => {
    const db = createTestDb();
    await importPack(db, scoredPack());
    const content = createContentRepo(db);
    expect((await content.getStoryDetail('a1-listen-fixture', 'part-1'))!.score).toMatchObject({
      trackId: 'lf-p1',
      localUri: null,
    });
    expect((await content.getStoryDetail('a1-listen-fixture', 'part-2'))!.score).toBeNull();
    expect(await content.countScores()).toEqual({ withUri: 0, withoutUri: 2 });
    await content.setScoreLocalUri('a1-listen-fixture', 'audio/lf-p3-score.opus', 'file:///s/3');
    expect(await content.countScores()).toEqual({ withUri: 1, withoutUri: 1 });
    const list = await content.listScoresForPack('a1-listen-fixture');
    expect(list.map((r) => [r.storyId, r.localUri])).toEqual(
      expect.arrayContaining([
        ['part-1', null],
        ['part-3', 'file:///s/3'],
      ]),
    );
  });

  it('the listen source puts each part score on its segment', async () => {
    const db = createTestDb();
    await importPack(db, scoredPack(), {
      audioFiles: { 'audio/lf-p1-score.opus': 'file:///p/s1' },
    });
    const src = await createListenRepo(db).getListenSource('a1-listen-fixture');
    expect(src!.segments.map((s) => s.score ?? null)).toEqual([
      { trackId: 'lf-p1', localUri: 'file:///p/s1', durationMs: 1206 },
      null,
      { trackId: 'lf-p3', localUri: null, durationMs: 1416 },
    ]);
  });
});

describe('sync: score files ride the audio path with per-file reuse (T115)', () => {
  const hasher: Hasher = async (b) => createHash('sha256').update(b).digest('hex');
  const bytes = (s: string) => new TextEncoder().encode(s);
  const sha = (s: string) => createHash('sha256').update(bytes(s)).digest('hex');

  it('score files are planned as (Wi-Fi-gated) audio', () => {
    const entry = {
      id: 'p',
      version: 2,
      type: 'stories' as const,
      level: 'A1' as const,
      title: { ru: 'p', en: 'p' },
      bytes: 1,
      files: [
        { path: 'pack.json', sha256: 'a'.repeat(64) },
        { path: 'audio/t1.opus', sha256: 'b'.repeat(64) },
        { path: 'audio/t1-score.opus', sha256: 'c'.repeat(64) },
      ],
    };
    expect(
      planPackFiles(entry, { wifiOnlyAudio: true, onWifi: true }).audio.map((f) => f.path),
    ).toEqual(['audio/t1.opus', 'audio/t1-score.opus']);
    expect(
      planPackFiles(entry, { wifiOnlyAudio: true, onWifi: false }).deferredAudio.map((f) => f.path),
    ).toContain('audio/t1-score.opus');
  });

  it('a v-bump that only adds a score re-uses the unchanged narration and fetches only the score', async () => {
    const staged = new Map<string, Uint8Array>([['audio/t1.opus', bytes('narration')]]);
    const fetched: string[] = [];
    const deps = {
      fetchRawFile: async (p: string) => {
        fetched.push(p);
        return bytes('score');
      },
      hasher,
      readStaged: async (p: string) => staged.get(p) ?? null,
      stage: (p: string, b: Uint8Array) => {
        staged.set(p, b);
        return `file:///new/${p}`;
      },
      stagedUri: (p: string) => `file:///old/${p}`,
    };
    const narration = await fetchOrReuseFile(
      'p',
      { path: 'audio/t1.opus', sha256: sha('narration') },
      deps,
    );
    const score = await fetchOrReuseFile(
      'p',
      { path: 'audio/t1-score.opus', sha256: sha('score') },
      deps,
    );
    expect(narration).toMatchObject({ reused: true, uri: 'file:///old/audio/t1.opus' });
    expect(score).toMatchObject({ reused: false, uri: 'file:///new/audio/t1-score.opus' });
    expect(fetched).toEqual(['packs/p/audio/t1-score.opus']);
  });
});
