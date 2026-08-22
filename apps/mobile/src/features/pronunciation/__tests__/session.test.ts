import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createRepositories } from '@/db/repositories';
import { createTestDb } from '@/db/__tests__/helpers';
import { ACTIVE_DIRECTIONS, Rating } from '@/db/repositories/reviews';
import type { ResolvedSentence } from '@/db/repositories/content';
import { cards } from '@/db/schema';

import { buildPronunciationSession, MAX_PROMPT_WORDS, PRON_SESSION_SIZE } from '../session';

/** T12: session sourcing from due production cards + prompt resolution. */

describe('production direction activation', () => {
  it('ACTIVE_DIRECTIONS now includes production, so bank adds create the card', async () => {
    expect(ACTIVE_DIRECTIONS).toContain('production');
    const repos = createRepositories(createTestDb());
    const { item } = await repos.bank.addWord({
      lemma: 'стук',
      surface: 'стук',
      translation: 'a knock',
    });
    const cards = await repos.reviews.listCardsForItem(item.id);
    expect(cards.map((c) => c.direction).sort()).toEqual([
      'en-ru',
      'listening',
      'production',
      'ru-en',
    ]);
  });

  it('backfillCards heals pre-T12 items with a production card', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'дверь',
      surface: 'дверь',
      translation: 'door',
    });
    // Simulate a pre-T12 state: drop the production row, then backfill
    // (which runs on every bootstrap).
    await db
      .delete(cards)
      .where(and(eq(cards.bankItemId, item.id), eq(cards.direction, 'production')));
    expect(
      (await repos.reviews.listCardsForItem(item.id)).some((c) => c.direction === 'production'),
    ).toBe(false);
    const created = await repos.reviews.backfillCards();
    expect(created).toBe(1);
    expect(
      (await repos.reviews.listCardsForItem(item.id)).some((c) => c.direction === 'production'),
    ).toBe(true);
  });
});

describe('buildPronunciationSession', () => {
  it('serves due production cards only, capped at PRON_SESSION_SIZE', async () => {
    const repos = createRepositories(createTestDb());
    for (let i = 0; i < 14; i++) {
      await repos.bank.addWord({
        lemma: `слово${i}`,
        surface: `слово${i}`,
        translation: `word-${i}`,
      });
    }
    const session = await buildPronunciationSession(repos);
    expect(session).toHaveLength(PRON_SESSION_SIZE);
    for (const entry of session) {
      expect(entry.card.direction).toBe('production');
      expect(entry.card.bankItemId).toBe(entry.item.id);
      expect(entry.promptRu.length).toBeGreaterThan(0);
    }
  });

  it('phrases prompt with the phrase itself; words without a source fall back to the lemma', async () => {
    const repos = createRepositories(createTestDb());
    await repos.bank.addPhrase({ surface: 'до свидания', translation: 'goodbye' });
    await repos.bank.addWord({ lemma: 'зеркало', surface: 'зеркале', translation: 'mirror' });

    const session = await buildPronunciationSession(repos);
    const phrase = session.find((s) => s.item.kind === 'phrase')!;
    expect(phrase.promptRu).toBe('до свидания');
    expect(phrase.source).toBe('phrase');

    const word = session.find((s) => s.item.kind === 'word')!;
    expect(word.promptRu).toBe('зеркало');
    expect(word.source).toBe('word');
  });

  it('words with a short source sentence prompt with the sentence; long ones fall back', async () => {
    const repos = createRepositories(createTestDb());
    await repos.bank.addWord({
      lemma: 'стена',
      surface: 'стене',
      translation: 'wall',
      sentenceId: 's-short',
    });
    await repos.bank.addWord({
      lemma: 'ночь',
      surface: 'ночью',
      translation: 'night',
      sentenceId: 's-long',
    });

    // Content tables need an installed pack to resolve for real; stub the
    // resolver — the unit under test is the prompt policy, not the join.
    const sentences: Record<string, string> = {
      's-short': 'Я слышу стук в стене.',
      's-long': Array.from({ length: MAX_PROMPT_WORDS + 3 }, (_, i) => `слово${i}`).join(' '),
    };
    repos.content.resolveSentence = async (id: string) =>
      ({
        sentence: { id, ru: sentences[id]!, en: 'stub' },
        story: null,
      }) as unknown as ResolvedSentence;

    const session = await buildPronunciationSession(repos);
    const short = session.find((s) => s.item.lemma === 'стена')!;
    expect(short.source).toBe('sentence');
    expect(short.promptRu).toBe('Я слышу стук в стене.');

    const long = session.find((s) => s.item.lemma === 'ночь')!;
    expect(long.source).toBe('word');
    expect(long.promptRu).toBe('ночь');
  });

  it('grading a production card reschedules it out of the due queue', async () => {
    const repos = createRepositories(createTestDb());
    await repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    const [entry] = await buildPronunciationSession(repos);
    await repos.reviews.gradeCard(entry!.card.id, Rating.Good);
    const after = await buildPronunciationSession(repos);
    expect(after.find((s) => s.card.id === entry!.card.id)).toBeUndefined();
  });
});
