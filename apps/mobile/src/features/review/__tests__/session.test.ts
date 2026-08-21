import { describe, expect, it } from 'vitest';

import { createRepositories } from '@/db/repositories';
import { createTestDb } from '@/db/__tests__/helpers';
import { Rating } from '@/db/repositories/reviews';

import { MC_FAST_THRESHOLD_MS, mcOutcomeToRating, ratingCountsAsCorrect } from '../mapping';
import { buildSession, MC_CHOICE_COUNT, SESSION_SIZE } from '../session';

/** T06: session generation + the MC outcome→rating mapping. */

describe('mcOutcomeToRating', () => {
  it('maps per design §7.3: correct-fast=Good, correct-slow=Hard, wrong=Again', () => {
    expect(mcOutcomeToRating(true, MC_FAST_THRESHOLD_MS)).toBe(Rating.Good);
    expect(mcOutcomeToRating(true, MC_FAST_THRESHOLD_MS + 1)).toBe(Rating.Hard);
    expect(mcOutcomeToRating(false, 500)).toBe(Rating.Again);
  });

  it('Again is the only rating that counts as a miss', () => {
    expect(ratingCountsAsCorrect(Rating.Again)).toBe(false);
    expect(ratingCountsAsCorrect(Rating.Hard)).toBe(true);
    expect(ratingCountsAsCorrect(Rating.Good)).toBe(true);
    expect(ratingCountsAsCorrect(Rating.Easy)).toBe(true);
  });
});

async function seedWords(repos: ReturnType<typeof createRepositories>, count: number) {
  const levels = ['A1', 'A2'] as const;
  const poses = ['noun', 'verb'];
  for (let i = 0; i < count; i++) {
    await repos.bank.addWord({
      lemma: `слово${i}`,
      surface: `слово${i}`,
      translation: `word-${i}`,
      pos: poses[i % poses.length],
      level: levels[i % levels.length],
    });
  }
}

describe('buildSession', () => {
  it('serves up to SESSION_SIZE due cards as a flashcard/MC mix', async () => {
    const repos = createRepositories(createTestDb());
    await seedWords(repos, 15); // 30 due cards
    const session = await buildSession(repos);
    expect(session).toHaveLength(SESSION_SIZE);

    const modes = new Set(session.map((s) => s.mode));
    expect(modes.has('mc')).toBe(true);
    expect(modes.has('flashcard')).toBe(true);

    for (const entry of session) {
      expect(['ru-en', 'en-ru']).toContain(entry.direction);
      expect(entry.card.bankItemId).toBe(entry.item.id);
      if (entry.mode === 'mc') {
        expect(entry.choices).toHaveLength(MC_CHOICE_COUNT);
        expect(entry.choices!.filter((c) => c.correct)).toHaveLength(1);
        const texts = entry.choices!.map((c) => c.text.toLowerCase());
        expect(new Set(texts).size).toBe(MC_CHOICE_COUNT);
      }
    }
  });

  it('returns fewer items when less is due, and none when nothing is', async () => {
    const repos = createRepositories(createTestDb());
    expect(await buildSession(repos)).toHaveLength(0);
    await seedWords(repos, 3);
    expect(await buildSession(repos)).toHaveLength(6);
  });

  it('skips cards whose item has no translation yet (needsEnrichment)', async () => {
    const repos = createRepositories(createTestDb());
    await seedWords(repos, 4);
    await repos.bank.addWord({
      lemma: 'загадка',
      surface: 'загадка',
      translation: '',
      needsEnrichment: true,
    });
    const session = await buildSession(repos);
    expect(session.some((s) => s.item.lemma === 'загадка')).toBe(false);
    expect(session).toHaveLength(8);
  });

  it('falls back to flashcards when the bank is too small for distractors', async () => {
    const repos = createRepositories(createTestDb());
    await seedWords(repos, 2); // max 1 distractor available — MC impossible
    const session = await buildSession(repos);
    expect(session).toHaveLength(4);
    expect(session.every((s) => s.mode === 'flashcard')).toBe(true);
  });

  it('MC distractor options come from POS/level-matched bank items', async () => {
    const repos = createRepositories(createTestDb());
    // 8 nouns A1 + 2 verbs A2 — plenty of exact-tier distractors for nouns.
    for (let i = 0; i < 8; i++) {
      await repos.bank.addWord({
        lemma: `сущ${i}`,
        surface: `сущ${i}`,
        translation: `noun-${i}`,
        pos: 'noun',
        level: 'A1',
      });
    }
    await repos.bank.addWord({
      lemma: 'бежать',
      surface: 'бежать',
      translation: 'to run',
      pos: 'verb',
      level: 'A2',
    });
    await repos.bank.addWord({
      lemma: 'кричать',
      surface: 'кричать',
      translation: 'to scream',
      pos: 'verb',
      level: 'A2',
    });

    const itemsById = new Map((await repos.bank.listItems()).map((i) => [i.id, i] as const));
    const session = await buildSession(repos);
    for (const entry of session) {
      if (entry.mode !== 'mc' || entry.item.pos !== 'noun') continue;
      for (const choice of entry.choices!) {
        const source = itemsById.get(choice.bankItemId)!;
        // The exact tier (noun/A1) has ≥7 candidates — no fallback should occur.
        expect(source.pos).toBe('noun');
        expect(source.level).toBe('A1');
      }
    }
  });
});
