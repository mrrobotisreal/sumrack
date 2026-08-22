import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import { Rating } from '@/db/repositories/reviews';
import { foldForAnswer } from '@/lib/text';

import { buildClozeSession, CLOZE_TILE_COUNT } from '../cloze/session';
import { seedStory } from './seed';

/** T13: cloze session generation. */

/** Seed one finished story whose words are also bank items (due cards exist via afterAdd). */
async function setup(wordCount = 8) {
  const db = createTestDb();
  const repos = createRepositories(db);
  const words = Array.from({ length: wordCount }, (_, i) => `слово${i}`);
  await seedStory(db, {
    packId: 'p1',
    storyId: 'st1',
    sentences: words.map((w, i) => ({
      id: `s${i}`,
      ru: `Вот ${w} здесь`,
      en: `Here is ${w}`,
      lemmas: ['вот', w, 'здесь'],
    })),
  });
  for (const w of words) {
    await repos.bank.addWord({
      lemma: w,
      surface: w,
      translation: `word-${w}`,
      pos: 'noun',
      level: 'A1',
    });
  }
  return { db, repos, words };
}

describe('buildClozeSession', () => {
  it('builds items from read-story sentences with alternating variants', async () => {
    const { repos } = await setup();
    await repos.reading.markFinished('p1', 'st1');
    const session = await buildClozeSession(repos, { limit: 6 });
    expect(session.length).toBe(6);

    for (const [i, entry] of session.entries()) {
      expect(entry.item.kind).toBe('word');
      const target = entry.source.tokens[entry.source.targetIndex]!;
      expect(target.lemmaNorm).toBe(entry.item.lemma);
      if (i % 2 === 0) {
        expect(entry.variant).toBe('tiles');
        expect(entry.tiles).toHaveLength(CLOZE_TILE_COUNT);
        // the correct surface is among the tiles (tolerant compare — tiles are lowercased)
        expect(entry.tiles!.some((t) => foldForAnswer(t) === foldForAnswer(target.text))).toBe(
          true,
        );
      } else {
        expect(entry.variant).toBe('typed');
      }
    }

    // one exercise per bank item
    const itemIds = session.map((e) => e.item.id);
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });

  it('returns nothing when no story has been read (toggle off, acceptance criterion)', async () => {
    const { repos } = await setup();
    expect(await buildClozeSession(repos)).toHaveLength(0);
  });

  it('unseenAllowed serves sentences from unread stories', async () => {
    const { repos } = await setup();
    const session = await buildClozeSession(repos, { unseenAllowed: true, limit: 4 });
    expect(session.length).toBe(4);
  });

  it('tops up with weak (not-due) cards when nothing is due', async () => {
    const { repos } = await setup(4);
    await repos.reading.markFinished('p1', 'st1');
    // Grade everything into the future so the due queue is empty.
    const due = await repos.reviews.listDueCards({ limit: 100 });
    for (const card of due) await repos.reviews.gradeCard(card.id, Rating.Good);
    expect(await repos.reviews.listDueCards({ limit: 100 })).toHaveLength(0);

    const session = await buildClozeSession(repos, { limit: 4 });
    expect(session.length).toBe(4);
  });

  it('skips phrases and falls back to typed when distractors run out', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedStory(db, {
      packId: 'p1',
      storyId: 'st1',
      sentences: [
        { id: 's0', ru: 'Тень растёт', en: 'The shadow grows', lemmas: ['тень', 'расти'] },
      ],
    });
    await repos.reading.markFinished('p1', 'st1');
    await repos.bank.addWord({ lemma: 'тень', surface: 'тень', translation: 'shadow' });
    await repos.bank.addPhrase({ surface: 'в темноте', translation: 'in the dark' });

    const session = await buildClozeSession(repos);
    // phrase excluded; the lone word has no distractor pool → typed
    expect(session).toHaveLength(1);
    expect(session[0]!.item.lemma).toBe('тень');
    expect(session[0]!.variant).toBe('typed');
    expect(session[0]!.tiles).toBeUndefined();
  });
});
