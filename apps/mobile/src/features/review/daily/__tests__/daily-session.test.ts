import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';

import { seedStory } from '../../games/__tests__/seed';
import { DEFAULT_DAILY_PREFS, type DailyWeights } from '../prefs';
import { buildDailySession, dailyItemBankItem, planTargets } from '../session';

/** T14: unified daily-session composition. */

const evenWeights = { flashcard: 1, mc: 1, cloze: 1, 'sentence-builder': 1, listening: 1 };

describe('planTargets', () => {
  it('splits slots by weight with largest-remainder rounding, summing exactly', () => {
    const targets = planTargets(evenWeights, 20);
    const total = Object.values(targets).reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
    expect(targets.flashcard).toBe(4);
    expect(targets.listening).toBe(4);
  });

  it('gives zero-weight modes zero slots', () => {
    const targets = planTargets({ ...evenWeights, listening: 0 }, 20);
    expect(targets.listening).toBe(0);
    expect(Object.values(targets).reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('respects relative weights', () => {
    const targets = planTargets(
      { flashcard: 4, mc: 0, cloze: 0, 'sentence-builder': 0, listening: 1 },
      10,
    );
    expect(targets.flashcard).toBe(8);
    expect(targets.listening).toBe(2);
  });

  it('heals all-zero weights to an even split instead of an empty plan', () => {
    const targets = planTargets(
      { flashcard: 0, mc: 0, cloze: 0, 'sentence-builder': 0, listening: 0 },
      10,
    );
    expect(Object.values(targets).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('is deterministic on ties', () => {
    expect(planTargets(evenWeights, 7)).toEqual(planTargets(evenWeights, 7));
  });
});

/**
 * Seed a finished story of N sentences whose middle word is banked — every
 * bank item then has due ru-en/en-ru/listening cards (afterAdd hook) and a
 * sourceable read sentence, so all five modes are eligible.
 */
async function setup(wordCount = 12) {
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
  await repos.reading.markFinished('p1', 'st1');
  for (const [i, w] of words.entries()) {
    await repos.bank.addWord({
      lemma: w,
      surface: w,
      translation: `word-${w}`,
      pos: 'noun',
      level: 'A1',
      sentenceId: `s${i}`,
      sourceStoryId: 'st1',
    });
  }
  return { db, repos, words };
}

function modeCounts(session: Awaited<ReturnType<typeof buildDailySession>>) {
  const counts: Record<string, number> = {};
  for (const item of session) counts[item.mode] = (counts[item.mode] ?? 0) + 1;
  return counts;
}

describe('buildDailySession', () => {
  it('serves a mixed session spanning many modes, capped at length', async () => {
    const { repos } = await setup(12);
    const session = await buildDailySession(repos, { length: 20 });
    expect(session.length).toBe(20);
    const counts = modeCounts(session);
    // 12 items × 3 directions due; even weights → listening ≈ 4 slots and
    // every text mode targeted. All modes are eligible here, so the plan
    // should survive contact with eligibility intact: ≥4 distinct modes.
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4);
    expect(counts.listening).toBeGreaterThan(0);
  });

  it('routes listening cards only to the listening mode and text cards never there', async () => {
    const { repos } = await setup(8);
    const session = await buildDailySession(repos, { length: 24 });
    for (const item of session) {
      if (item.mode === 'listening') {
        expect(item.entry.card.direction).toBe('listening');
      } else {
        expect(['ru-en', 'en-ru']).toContain(item.entry.card.direction);
      }
    }
  });

  it('weight 0 excludes a mode', async () => {
    const { repos } = await setup(10);
    const weights: DailyWeights = {
      flashcard: 1,
      mc: 1,
      cloze: 1,
      sentenceBuilder: 1,
      listening: 0,
    };
    const session = await buildDailySession(repos, { length: 20, weights });
    expect(modeCounts(session).listening).toBeUndefined();
    // Listening cards stay due — the session still fills from text cards.
    expect(session.length).toBe(20);
  });

  it('rebalances toward listening when text cards run out', async () => {
    const { repos } = await setup(4);
    // 4 items × (ru-en + en-ru) = 8 text cards, 4 listening cards.
    const session = await buildDailySession(repos, { length: 12 });
    expect(session.length).toBe(12);
    expect(modeCounts(session).listening).toBe(4);
  });

  it('degrades cloze/sentence-builder to other modes when sentences are unsourceable', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    // Bank words with no story at all — nothing for the sentence games to quote.
    for (let i = 0; i < 6; i++) {
      await repos.bank.addWord({
        lemma: `дом${i}`,
        surface: `дом${i}`,
        translation: `house-${i}`,
        pos: 'noun',
        level: 'A1',
      });
    }
    const session = await buildDailySession(repos, { length: 12 });
    expect(session.length).toBe(12);
    const counts = modeCounts(session);
    expect(counts.cloze).toBeUndefined();
    expect(counts['sentence-builder']).toBeUndefined();
    // Their slots landed on modes that could serve — nothing errored or starved.
    expect((counts.flashcard ?? 0) + (counts.mc ?? 0) + (counts.listening ?? 0)).toBe(12);
  });

  it('serves at most one sentence-quoting game per bank item', async () => {
    const { repos } = await setup(6);
    const weights: DailyWeights = {
      flashcard: 0,
      mc: 0,
      cloze: 5,
      sentenceBuilder: 5,
      listening: 0,
    };
    const session = await buildDailySession(repos, { length: 12, weights });
    const sentenceGameItems = session
      .filter((s) => s.mode === 'cloze' || s.mode === 'sentence-builder')
      .map((s) => dailyItemBankItem(s).id);
    expect(new Set(sentenceGameItems).size).toBe(sentenceGameItems.length);
  });

  it('skips unenriched text cards but keeps their listening card in play', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await repos.bank.addWord({ lemma: 'тень', surface: 'тень', translation: '' });
    const session = await buildDailySession(repos, { length: 10 });
    // Only the listening direction can serve a gloss-less item.
    expect(session.length).toBe(1);
    expect(session[0]!.mode).toBe('listening');
  });

  it('returns empty when nothing is due', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    expect(await buildDailySession(repos)).toEqual([]);
  });

  it('never repeats a card within a session', async () => {
    const { repos } = await setup(10);
    const session = await buildDailySession(repos, { length: DEFAULT_DAILY_PREFS.length });
    const cardIds = session.map((s) => s.entry.card.id);
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });
});
