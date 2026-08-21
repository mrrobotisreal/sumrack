import { describe, expect, it } from 'vitest';

import { createReadingRepo, readStateOf } from '../repositories/reading';
import { createTestDb } from './helpers';

describe('reading repository (story progress, T04)', () => {
  it('read state derives from the progress row', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    expect(readStateOf(await reading.getProgress('p1', 's1'))).toBe('unread');

    await reading.savePosition('p1', 's1', 3);
    expect(readStateOf(await reading.getProgress('p1', 's1'))).toBe('in-progress');

    await reading.markFinished('p1', 's1');
    expect(readStateOf(await reading.getProgress('p1', 's1'))).toBe('finished');
  });

  it('savePosition upserts and preserves finishedAt on reread', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    await reading.savePosition('p1', 's1', 2);
    await reading.savePosition('p1', 's1', 7);
    let row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(7);
    expect(row?.finishedAt).toBeNull();

    await reading.markFinished('p1', 's1');
    // Rereading from the top must not clear the finished fact.
    await reading.savePosition('p1', 's1', 0);
    row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(0);
    expect(row?.finishedAt).not.toBeNull();
  });

  it('markFinished is idempotent and reports only the first finish', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    // Finishing with no prior progress row also works (short story, one screen).
    expect(await reading.markFinished('p1', 's1')).toBe(true);
    const first = await reading.getProgress('p1', 's1');

    expect(await reading.markFinished('p1', 's1')).toBe(false);
    const second = await reading.getProgress('p1', 's1');
    expect(second?.finishedAt).toBe(first?.finishedAt);
  });

  it('listProgress returns rows keyed per (pack, story)', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    await reading.savePosition('p1', 's1', 1);
    await reading.savePosition('p1', 's2', 4);
    // Same story id under a different pack is a distinct row.
    await reading.savePosition('p2', 's1', 9);

    const rows = await reading.listProgress();
    expect(rows).toHaveLength(3);
    const keys = rows.map((r) => `${r.packId}/${r.storyId}`).sort();
    expect(keys).toEqual(['p1/s1', 'p1/s2', 'p2/s1']);
  });
});
