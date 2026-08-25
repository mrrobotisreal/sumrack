import type { Pack } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import pack1Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import pack2Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-002/pack.json';

import { STABILITY_MATURE_MIN, STABILITY_YOUNG_MIN } from '@/lib/mastery';

import { importPack } from '../importer';
import { createBankRepo } from '../repositories/bank';
import { createBookmarksRepo } from '../repositories/bookmarks';
import { createContentRepo } from '../repositories/content';
import { cards } from '../schema';
import { createTestDb } from './helpers';
import type { SumrakDB } from '../types';

const pack1 = pack1Json as unknown as Pack;
const pack2 = pack2Json as unknown as Pack;

// --- global search (T24 item 3) --------------------------------------------

describe('content.searchSentences (global search)', () => {
  it('groups token hits per sentence with story/pack context and orderIdx', async () => {
    const db = createTestDb();
    await importPack(db, pack1);
    const content = createContentRepo(db);

    const hits = await content.searchSentences('стена');
    expect(hits.length).toBeGreaterThan(0);
    // One row per sentence, never per token.
    const ids = hits.map((h) => h.sentenceId);
    expect(new Set(ids).size).toBe(ids.length);
    const hit = hits[0]!;
    expect(hit.packId).toBe('a1-creepypasta-001');
    expect(hit.storyTitleRu.length).toBeGreaterThan(0);
    expect(hit.packTitleRu.length).toBeGreaterThan(0);
    expect(hit.level).toBe('A1');
    expect(hit.orderIdx).toBeGreaterThanOrEqual(0);
    expect(hit.ru.length).toBeGreaterThan(0);
    expect(hit.matchedTexts.length).toBeGreaterThan(0);
  });

  it('is ё/е-tolerant in both directions', async () => {
    const db = createTestDb();
    await importPack(db, pack2);
    const content = createContentRepo(db);

    const viaE = await content.searchSentences('черный');
    const viaYo = await content.searchSentences('чёрный');
    expect(viaE.length).toBeGreaterThan(0);
    expect(viaE.map((h) => h.sentenceId).sort()).toEqual(viaYo.map((h) => h.sentenceId).sort());
  });

  it('returns [] for empty/garbage queries and respects the limit', async () => {
    const db = createTestDb();
    await importPack(db, pack1);
    const content = createContentRepo(db);
    expect(await content.searchSentences('   ')).toEqual([]);
    expect(await content.searchSentences('!!!')).toEqual([]);
    const limited = await content.searchSentences('в', 2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});

// --- bookmarks (T24 item 4) -------------------------------------------------

describe('bookmarks repository', () => {
  it('story toggle adds then removes; unique per (pack, story)', async () => {
    const db = createTestDb();
    const repo = createBookmarksRepo(db);

    expect((await repo.toggleStory('p1', 's1')).added).toBe(true);
    expect(await repo.count()).toBe(1);
    // Toggle again = remove, never a duplicate/unique-violation.
    expect((await repo.toggleStory('p1', 's1')).added).toBe(false);
    expect(await repo.count()).toBe(0);
  });

  it('sentence toggle is independent of a story bookmark on the same story', async () => {
    const db = createTestDb();
    const repo = createBookmarksRepo(db);

    await repo.toggleStory('p1', 'story-a');
    await repo.toggleSentence('p1', 'story-a', 'sent-1');
    await repo.toggleSentence('p1', 'story-a', 'sent-2');
    expect(await repo.count()).toBe(3);

    const forStory = await repo.listForStory('p1', 'story-a');
    expect(forStory).toHaveLength(3);
    expect(forStory.filter((b) => b.kind === 'sentence')).toHaveLength(2);

    // Removing one sentence bookmark leaves the rest.
    await repo.toggleSentence('p1', 'story-a', 'sent-1');
    expect(await repo.count()).toBe(2);
  });

  it('list is newest-first and rows Zod-validate', async () => {
    const db = createTestDb();
    const repo = createBookmarksRepo(db);
    await repo.toggleStory('p1', 'older');
    await new Promise((r) => setTimeout(r, 5));
    await repo.toggleSentence('p1', 'story-b', 'newer-sent');

    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.sentenceId).toBe('newer-sent');
    expect(list[1]!.kind).toBe('story');
  });

  it('storyKeySet only includes story-kind bookmarks', async () => {
    const db = createTestDb();
    const repo = createBookmarksRepo(db);
    await repo.toggleStory('p1', 'story-a');
    await repo.toggleSentence('p1', 'story-b', 's9');
    const keys = await repo.storyKeySet();
    expect(keys.has('p1/story-a')).toBe(true);
    expect(keys.has('p1/story-b')).toBe(false);
  });

  it('remove(id) deletes exactly one row', async () => {
    const db = createTestDb();
    const repo = createBookmarksRepo(db);
    await repo.toggleStory('p1', 'a');
    await repo.toggleStory('p1', 'b');
    const [first] = await repo.list();
    await repo.remove(first!.id);
    const rest = await repo.list();
    expect(rest).toHaveLength(1);
    expect(rest[0]!.id).not.toBe(first!.id);
  });
});

// --- mastery filter (T24 item 2) --------------------------------------------

/** Insert a reviewed card with a chosen stability (direction defaults to core). */
async function seedCard(
  db: SumrakDB,
  bankItemId: string,
  stability: number,
  opts: { direction?: 'ru-en' | 'en-ru' | 'listening' | 'production'; reps?: number } = {},
) {
  await db.insert(cards).values({
    id: `card-${bankItemId}-${opts.direction ?? 'ru-en'}`,
    bankItemId,
    direction: opts.direction ?? 'ru-en',
    dueAt: Date.now(),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: opts.reps ?? 1,
    lapses: 0,
    state: 2,
    lastReviewAt: Date.now(),
    createdAt: Date.now(),
  });
}

describe('bank mastery filter + counts', () => {
  async function seed(db: SumrakDB) {
    const bank = createBankRepo(db);
    const mk = (lemma: string) =>
      bank.addWord({ lemma, surface: lemma, translation: 'x' }).then((r) => r.item.id);

    const shaky = await mk('один');
    const young = await mk('два');
    const mature = await mk('три');
    const collected = await mk('четыре');
    const weakestLink = await mk('пять');
    const nonCoreOnly = await mk('шесть');

    await seedCard(db, shaky, STABILITY_YOUNG_MIN - 1);
    await seedCard(db, young, STABILITY_YOUNG_MIN);
    await seedCard(db, mature, STABILITY_MATURE_MIN + 10);
    // Weakest link: one mature ru-en card, one shaky en-ru card → learning.
    await seedCard(db, weakestLink, STABILITY_MATURE_MIN + 5);
    await seedCard(db, weakestLink, 2, { direction: 'en-ru' });
    // Only a production card reviewed → does not vouch → collected.
    await seedCard(db, nonCoreOnly, 50, { direction: 'production' });
    // An unreviewed core card (reps=0) also doesn't vouch.
    await seedCard(db, collected, 40, { reps: 0 });

    return { bank, shaky, young, mature, collected, weakestLink, nonCoreOnly };
  }

  it('filters each band by weakest reviewed core card (T18 definition)', async () => {
    const db = createTestDb();
    const { bank, shaky, young, mature, collected, weakestLink, nonCoreOnly } = await seed(db);

    const idsOf = async (mastery: 'learning' | 'young' | 'mature' | 'collected') =>
      (await bank.listItems({ mastery })).map((i) => i.id).sort();

    expect(await idsOf('learning')).toEqual([shaky, weakestLink].sort());
    expect(await idsOf('young')).toEqual([young]);
    expect(await idsOf('mature')).toEqual([mature]);
    expect(await idsOf('collected')).toEqual([collected, nonCoreOnly].sort());
  });

  it('mastery combines with the existing filters', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const a = await bank.addWord({ lemma: 'семь', surface: 'семь', translation: 's', level: 'A1' });
    const b = await bank.addWord({
      lemma: 'восемь',
      surface: 'восемь',
      translation: 'v',
      level: 'A2',
    });
    await seedCard(db, a.item.id, 1);
    await seedCard(db, b.item.id, 2);

    const filtered = await bank.listItems({ mastery: 'learning', level: 'A1' });
    expect(filtered.map((i) => i.id)).toEqual([a.item.id]);
  });

  it('getMasteryCounts matches the per-band filter counts', async () => {
    const db = createTestDb();
    const { bank } = await seed(db);

    const counts = await bank.getMasteryCounts();
    expect(counts.learning).toBe((await bank.listItems({ mastery: 'learning' })).length);
    expect(counts.young).toBe((await bank.listItems({ mastery: 'young' })).length);
    expect(counts.mature).toBe((await bank.listItems({ mastery: 'mature' })).length);
    expect(counts.collected).toBe((await bank.listItems({ mastery: 'collected' })).length);
    expect(counts.learning + counts.young + counts.mature + counts.collected).toBe(6);
  });
});
