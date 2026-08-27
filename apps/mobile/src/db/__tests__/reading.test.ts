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
    // Rereading from the top must not clear the finished fact, and (T30.2)
    // must not lower the saved index either.
    await reading.savePosition('p1', 's1', 0);
    row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(7);
    expect(row?.finishedAt).not.toBeNull();
  });

  it('savePosition never regresses the saved index (T30.2)', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    // The CT002b failure case: open → read nothing → leave writes 0.
    await reading.savePosition('p1', 's1', 5);
    await reading.savePosition('p1', 's1', 0);
    let row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(5);

    // Partial re-scroll below the saved point: no regress.
    await reading.savePosition('p1', 's1', 3);
    row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(5);

    // Normal reading past the saved point still advances.
    await reading.savePosition('p1', 's1', 9);
    row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(9);

    // A revisit save at the same index changes nothing.
    await reading.savePosition('p1', 's1', 9);
    row = await reading.getProgress('p1', 's1');
    expect(row?.currentSentenceIdx).toBe(9);
  });

  it('a lower save still bumps updatedAt (the story was touched)', async () => {
    const db = createTestDb();
    const reading = createReadingRepo(db);

    await reading.savePosition('p1', 's1', 5);
    const before = await reading.getProgress('p1', 's1');
    await new Promise((r) => setTimeout(r, 2));
    await reading.savePosition('p1', 's1', 0);
    const after = await reading.getProgress('p1', 's1');
    expect(after?.currentSentenceIdx).toBe(5);
    expect(after?.updatedAt).toBeGreaterThan(before!.updatedAt);
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
