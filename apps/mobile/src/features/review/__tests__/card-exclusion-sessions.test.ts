import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories, type Repositories } from '@/db/repositories';
import { seedStory } from '@/features/review/games/__tests__/seed';

import { buildSession } from '../session';
import { buildDailySession } from '../daily/session';
import { buildClozeSession } from '../games/cloze/session';
import { buildSbSession } from '../games/sentence-builder/session';
import { buildListeningSession } from '../games/listening/session';
import { buildPronunciationSession } from '@/features/pronunciation/session';

/**
 * T39 exclusion audit for the session builders. Each test seeds due cards,
 * suspends one item and buries another (both directions), then asserts the
 * real exported build function never serves either card.
 */

const NOW = Date.now();
const WORDS = ['слово0', 'слово1', 'слово2', 'слово3', 'слово4', 'слово5', 'слово6', 'слово7'];

/** A read story whose sentences carry every word, so cloze/sb/listening can source them. */
async function setup() {
  const db = createTestDb();
  const repos: Repositories = createRepositories(db);
  await seedStory(db, {
    packId: 'p1',
    storyId: 'st1',
    sentences: WORDS.map((w, i) => ({
      id: `s${i}`,
      ru: `Вот ${w} здесь`,
      en: `Here is ${w}`,
      lemmas: ['вот', w, 'здесь'],
    })),
  });
  await repos.reading.markFinished('p1', 'st1');
  const ids: Record<string, string> = {};
  for (const [i, w] of WORDS.entries()) {
    const { item } = await repos.bank.addWord({
      lemma: w,
      surface: w,
      translation: `word-${w}`,
      pos: 'noun',
      level: 'A1',
      sentenceId: `s${i}`,
      sourceStoryId: 'st1',
    });
    ids[w] = item.id;
  }
  // The suspended item and the buried item (both must never surface).
  const suspendedItem = ids[WORDS[0]!]!;
  const buriedItem = ids[WORDS[1]!]!;
  for (const dir of ['ru-en', 'en-ru', 'listening', 'production'] as const) {
    const s = (await repos.reviews.getCard(suspendedItem, dir))!;
    await repos.reviews.suspendCard(s.id, NOW);
    const b = (await repos.reviews.getCard(buriedItem, dir))!;
    await repos.reviews.buryUntilTomorrow(b.id, NOW);
  }
  return { repos, suspendedItem, buriedItem, ids };
}

/** Item ids served by a session builder, whatever its item shape. */
function servedItemIds(items: { item: { id: string } }[]): string[] {
  return items.map((i) => i.item.id);
}

describe('T39 exclusion audit — session builders', () => {
  it('flashcard/MC session (buildSession) never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildSession(repos, { now: NOW + 1000, limit: 20 });
    const served = session.map((s) => s.item.id);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
    expect(served.length).toBeGreaterThan(0);
  });

  it('daily session (normal) never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildDailySession(repos, { length: 20, now: NOW + 1000 });
    const served = session
      .filter(
        (d): d is Extract<typeof d, { mode: string }> & { item: { id: string } } => 'item' in d,
      )
      .map((d) => d.item.id);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('daily session (focus) never serves a suspended or buried item, even when flagged', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildDailySession(repos, {
      length: 20,
      now: NOW + 1000,
      focusItemIds: [suspendedItem, buriedItem],
    });
    const served = session
      .filter(
        (d): d is Extract<typeof d, { mode: string }> & { item: { id: string } } => 'item' in d,
      )
      .map((d) => d.item.id);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('cloze session never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildClozeSession(repos, { limit: 10, now: NOW + 1000 });
    const served = servedItemIds(session);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('sentence-builder session never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildSbSession(repos, { limit: 10, now: NOW + 1000 });
    const served = servedItemIds(session);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('listening session never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildListeningSession(repos, { limit: 10, now: NOW + 1000 });
    const served = servedItemIds(session);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('pronunciation session (normal) never serves a suspended or buried item', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildPronunciationSession(repos, { limit: 10, now: NOW + 1000 });
    const served = servedItemIds(session);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('pronunciation session (focus) never serves a suspended or buried item, even when flagged', async () => {
    const { repos, suspendedItem, buriedItem } = await setup();
    const session = await buildPronunciationSession(repos, {
      limit: 10,
      now: NOW + 1000,
      focusItemIds: [suspendedItem, buriedItem],
    });
    const served = servedItemIds(session);
    expect(served).not.toContain(suspendedItem);
    expect(served).not.toContain(buriedItem);
  });

  it('the suspension is per-card: a non-suspended sibling item still serves', async () => {
    const { repos, ids } = await setup();
    const session = await buildSession(repos, { now: NOW + 1000, limit: 20 });
    expect(servedItemIds(session)).toContain(ids[WORDS[2]!]!);
  });
});
