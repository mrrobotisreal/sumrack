import type { Pack } from '@sumrak/schema';
import dialogueJson from '@sumrak/schema/fixtures/packs/a2-dialogue-001/pack.json';
import examJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import listenJson from '@sumrak/schema/fixtures/packs/a1-listen-fixture/pack.json';
import pack1Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import { describe, expect, it } from 'vitest';

import { importPack } from '../importer';
import { createListenRepo } from '../repositories/listen';
import { createTestDb } from './helpers';

const listenPack = listenJson as unknown as Pack;
const FULL = 'audio/a1-listen-fixture-full.opus';

describe('listen repository (T95)', () => {
  it('full source: stories[] order, joined titles, pending until the uri lands', async () => {
    const db = createTestDb();
    const listen = createListenRepo(db);
    await importPack(db, listenPack);
    let src = await listen.getListenSource('a1-listen-fixture');
    expect(src).toMatchObject({ kind: 'full', uri: null, durationMs: 5906, coverUri: null });
    expect(src!.segments.map((s) => [s.storyId, s.orderIdx])).toEqual([
      ['part-1', 0],
      ['part-2', 1],
      ['part-3', 2],
    ]);
    expect(src!.segments.every((s) => s.titleRu.length > 0)).toBe(true);
    expect(
      (await listen.listListenAvailability(['a1-listen-fixture'])).get('a1-listen-fixture'),
    ).toMatchObject({ state: 'pending', parts: 3, durationMs: 5906 });

    await listen.setFullAudioLocalUri('a1-listen-fixture', 'file:///full.opus');
    await listen.setCoverLocalUri('a1-listen-fixture', 'file:///cover.jpg');
    src = await listen.getListenSource('a1-listen-fixture');
    expect(src).toMatchObject({ uri: 'file:///full.opus', coverUri: 'file:///cover.jpg' });
    expect(
      (await listen.listListenAvailability(['a1-listen-fixture'])).get('a1-listen-fixture')!.state,
    ).toBe('ready');
  });

  it('single source for a one-story pack; pending without uri, ready with', async () => {
    const db = createTestDb();
    const listen = createListenRepo(db);
    await importPack(db, pack1Json as unknown as Pack);
    const src = await listen.getListenSource('a1-creepypasta-001');
    expect(src).toMatchObject({ kind: 'single', packId: 'a1-creepypasta-001' });
    expect(src!.segments).toHaveLength(1);
    expect(src!.segments[0]).toMatchObject({ startMs: 0, endMs: src!.durationMs, orderIdx: 0 });
    expect(
      (await listen.listListenAvailability(['a1-creepypasta-001'])).get('a1-creepypasta-001')!
        .state,
    ).toBe('pending');
  });

  it('null / none for dialogue, exam, multi-story without fullStory, and unknown packs', async () => {
    const db = createTestDb();
    const listen = createListenRepo(db);
    const multi: Pack = JSON.parse(JSON.stringify(listenPack));
    multi.id = 'a1-multi-nofull';
    delete multi.fullStory;
    await importPack(db, multi);
    await importPack(db, dialogueJson as unknown as Pack);
    await importPack(db, examJson as unknown as Pack);
    const ids = ['a1-multi-nofull', 'a2-dialogue-001', 'a1-exam-fixture', 'nope'];
    for (const id of ids) expect(await listen.getListenSource(id)).toBeNull();
    const avail = await listen.listListenAvailability(ids);
    for (const id of ids) expect(avail.get(id)!.state).toBe('none');
  });
});
