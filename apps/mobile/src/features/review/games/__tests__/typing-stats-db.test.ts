import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { bankItems, cards, dailyActivity } from '@/db/schema';
import type { SumrakDB } from '@/db/types';

import { pickNextWord, type TypingAttempt } from '../typing/engine';
import { DEFAULT_TYPING_STATS, mergeTypingStats, parseTypingStats } from '../typing/stats';
import { finishTypingRound, loadTypingStats, startTypingRound } from '../typing/service';

/**
 * T40 — DB-backed typing trainer: sourcing query (exact stability per band,
 * word-kind / multi-word / Latin filtering), weighted frequency, stats heal
 * and merge, and the zero-review-log service path.
 */

/** Bank word with its ru-en and en-ru cards set to a stability (days) and reps. */
async function seedWord(
  db: SumrakDB,
  repos: ReturnType<typeof createRepositories>,
  lemma: string,
  stability: number | null,
): Promise<string> {
  const { item } = await repos.bank.addWord({ lemma, surface: lemma, translation: `en-${lemma}` });
  if (stability != null) {
    // ensureCards already created ru-en/en-ru; mark them reviewed with the stability.
    await db
      .update(cards)
      .set({ stability, reps: 2 })
      .where(sql`${cards.bankItemId} = ${item.id} AND ${cards.direction} IN ('ru-en','en-ru')`);
  }
  return item.id;
}

describe('listTypingCandidates (query level)', () => {
  it('returns each item with its weakest-link core stability, null when never reviewed', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const learning = await seedWord(db, repos, 'дом', 3);
    const young = await seedWord(db, repos, 'кошка', 12);
    const mature = await seedWord(db, repos, 'окно', 45);
    const fresh = await seedWord(db, repos, 'ёлка', null);
    const rows = await repos.bank.listTypingCandidates();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(learning)?.minCoreStability).toBe(3);
    expect(byId.get(young)?.minCoreStability).toBe(12);
    expect(byId.get(mature)?.minCoreStability).toBe(45);
    expect(byId.get(fresh)?.minCoreStability).toBeNull();
    expect(byId.get(learning)?.lemma).toBe('дом');
    expect(byId.get(learning)?.translation).toBe('en-дом');
  });

  it('uses the WEAKEST core card: a mature ru-en with a learning en-ru is learning', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'сила',
      surface: 'силой',
      translation: 'force',
    });
    await db
      .update(cards)
      .set({ stability: 50, reps: 3 })
      .where(sql`${cards.bankItemId} = ${item.id} AND ${cards.direction} = 'ru-en'`);
    await db
      .update(cards)
      .set({ stability: 2, reps: 1 })
      .where(sql`${cards.bankItemId} = ${item.id} AND ${cards.direction} = 'en-ru'`);
    const row = (await repos.bank.listTypingCandidates()).find((r) => r.id === item.id);
    expect(row?.minCoreStability).toBe(2);
  });

  it('ignores a card with reps = 0 (never reviewed) even if its stability is set', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'вода',
      surface: 'воду',
      translation: 'water',
    });
    await db
      .update(cards)
      .set({ stability: 1, reps: 0 })
      .where(sql`${cards.bankItemId} = ${item.id}`);
    const row = (await repos.bank.listTypingCandidates()).find((r) => r.id === item.id);
    expect(row?.minCoreStability).toBeNull();
  });

  it('excludes phrases, multi-word lemmas, and Latin-letter words', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    await repos.bank.addWord({
      lemma: 'большой дом',
      surface: 'большой дом',
      translation: 'big house',
    });
    await repos.bank.addWord({ lemma: 'iPhone', surface: 'iPhone', translation: 'phone' });
    await repos.bank.addWord({ lemma: 'телефон5G', surface: 'телефон5G', translation: 'phone' });
    await repos.bank.addPhrase({ surface: 'доброе утро', translation: 'good morning' });
    const lemmas = (await repos.bank.listTypingCandidates()).map((r) => r.lemma);
    expect(lemmas).toEqual(['дом']);
  });

  it('falls back to surface when lemma is null (never for words, but the query must not drop the row)', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    // A non-word-kind row cannot carry a null lemma via the repo, so seed raw SQL:
    // one word row with lemma NULL and surface 'кофе'.
    const id = 'raw-word-1';
    await db.insert(bankItems).values({
      id,
      kind: 'word',
      lemma: null,
      lemmaNorm: null,
      surface: 'кофе',
      normalized: 'кофе',
      translation: 'coffee',
      createdAt: 1,
    });
    const row = (await repos.bank.listTypingCandidates()).find((r) => r.id === id);
    expect(row?.lemma).toBe('кофе');
  });
});

describe('weighted sourcing frequency (seeded rng, 10 000 picks)', () => {
  /** Deterministic LCG — the frequency assertions must not flake. */
  function lcg(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function bandOf(minCoreStability: number | null): 'learning' | 'young' | 'mature' | 'unreviewed' {
    if (minCoreStability == null) return 'unreviewed';
    if (minCoreStability < 7) return 'learning';
    if (minCoreStability < 30) return 'young';
    return 'mature';
  }

  it('one item per band samples learning:young:mature = 3:2:1 (±10 %)', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedWord(db, repos, 'один', 2); // learning, weight 3
    await seedWord(db, repos, 'два', 12); // young, weight 2
    await seedWord(db, repos, 'три', 40); // mature, weight 1
    const rows = await repos.bank.listTypingCandidates();
    expect(rows).toHaveLength(3);

    const N = 10_000;
    const rng = lcg(42);
    const counts = { learning: 0, young: 0, mature: 0, unreviewed: 0 };
    for (let i = 0; i < N; i++) {
      counts[bandOf(pickNextWord(rows, [], rng)!.minCoreStability)]++;
    }
    // Total weight 6 → expected shares 3/6, 2/6, 1/6.
    expect(counts.learning / N).toBeGreaterThan(0.5 * 0.9);
    expect(counts.learning / N).toBeLessThan(0.5 * 1.1);
    expect(counts.young / N).toBeGreaterThan((1 / 3) * 0.9);
    expect(counts.young / N).toBeLessThan((1 / 3) * 1.1);
    expect(counts.mature / N).toBeGreaterThan((1 / 6) * 0.9);
    expect(counts.mature / N).toBeLessThan((1 / 6) * 1.1);
  });

  it('never-reviewed items are weighted as shaky (×3, same as learning)', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedWord(db, repos, 'четыре', null); // unreviewed, weight 3
    await seedWord(db, repos, 'три', 40); // mature, weight 1
    const rows = await repos.bank.listTypingCandidates();

    const N = 10_000;
    const rng = lcg(7);
    const counts = { unreviewed: 0, mature: 0 };
    for (let i = 0; i < N; i++) {
      const pick = pickNextWord(rows, [], rng)!;
      counts[bandOf(pick.minCoreStability) as 'unreviewed' | 'mature']++;
    }
    // Expected 3:1 → shares 0.75 / 0.25.
    expect(counts.unreviewed / N).toBeGreaterThan(0.75 * 0.9);
    expect(counts.unreviewed / N).toBeLessThan(0.75 * 1.1);
  });
});

describe('stats heal + merge', () => {
  it('heals corrupt or foreign values to the defaults', () => {
    expect(parseTypingStats(null)).toEqual(DEFAULT_TYPING_STATS);
    expect(parseTypingStats('garbage')).toEqual(DEFAULT_TYPING_STATS);
    expect(parseTypingStats({ v: 2, bestWpm: 9 })).toEqual(DEFAULT_TYPING_STATS);
    expect(
      parseTypingStats({
        v: 1,
        bestWpm: -1,
        bestAccuracy: 0,
        rounds: 0,
        totalWords: 0,
        totalCorrectChars: 0,
        lastPlayedAt: null,
      }),
    ).toEqual(DEFAULT_TYPING_STATS);
  });

  it('keeps a valid stored value unchanged', () => {
    const v = {
      v: 1 as const,
      bestWpm: 31.5,
      bestAccuracy: 0.9,
      rounds: 4,
      totalWords: 40,
      totalCorrectChars: 300,
      lastPlayedAt: 1000,
    };
    expect(parseTypingStats(v)).toEqual(v);
  });

  it('bestWpm only counts rounds with accuracy >= 0.7', () => {
    const merged = mergeTypingStats(
      DEFAULT_TYPING_STATS,
      { words: 10, correctChars: 80, wpm: 40, accuracy: 0.6 },
      1,
    );
    expect(merged.bestWpm).toBe(0);
    expect(merged.rounds).toBe(1);
    const ok = mergeTypingStats(merged, { words: 10, correctChars: 60, wpm: 25, accuracy: 0.8 }, 2);
    expect(ok.bestWpm).toBe(25);
  });

  it('bestAccuracy only counts rounds with >= 10 words', () => {
    const short = mergeTypingStats(
      DEFAULT_TYPING_STATS,
      { words: 4, correctChars: 20, wpm: 10, accuracy: 1 },
      1,
    );
    expect(short.bestAccuracy).toBe(0);
    const long = mergeTypingStats(
      short,
      { words: 12, correctChars: 60, wpm: 10, accuracy: 0.92 },
      2,
    );
    expect(long.bestAccuracy).toBe(0.92);
  });

  it('a zero-word round changes nothing', () => {
    const prev = { ...DEFAULT_TYPING_STATS, rounds: 3, bestWpm: 12 };
    expect(mergeTypingStats(prev, { words: 0, correctChars: 0, wpm: 0, accuracy: 0 }, 9)).toBe(
      prev,
    );
  });
});

describe('finishTypingRound (service, against the test DB)', () => {
  it('writes one finished typing game_session, XP into daily_activity, and ZERO review_log / card writes', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedWord(db, repos, 'дом', 3);
    await seedWord(db, repos, 'кошка', 12);
    await seedWord(db, repos, 'окно', 45);

    const cardsBefore = await db.all<{
      id: string;
      stability: number;
      reps: number;
      due_at: number;
    }>(sql`SELECT id, stability, reps, due_at FROM cards ORDER BY id`);
    const reviewLogBefore = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM review_log`);
    expect(reviewLogBefore[0]!.n).toBe(0);

    const deps = {
      repos,
      evaluate: async () => {},
      onSessionEnded: async () => {},
      now: () => 1_000_000,
    };
    const sessionId = await startTypingRound(repos);
    const attempts: TypingAttempt[] = [
      { expected: 'дом', typed: 'дом', correct: true, msTaken: 1000 },
      { expected: 'кошка', typed: 'кошка', correct: true, msTaken: 2000 },
      { expected: 'окно', typed: 'окн', correct: false, msTaken: 1500 },
      { expected: 'ёлка', typed: 'елка', correct: true, msTaken: 1200 },
    ];
    const res = await finishTypingRound(deps, sessionId, attempts, 30_000);

    // Hand-computed round from the engine test: wpm 6.0, accuracy 0.75, 15 correct chars.
    expect(res.stats.wpm).toBe(6);
    expect(res.stats.accuracy).toBe(0.75);
    // 6.0 wpm is < 10, so the bracket is the first one (5) — and accuracy 0.75 ≥ 0.7 does not cap.
    expect(res.xp).toBe(5);

    const sessions = await repos.stats.listGameSessions();
    const typing = sessions.filter((s) => s.mode === 'typing');
    expect(typing).toHaveLength(1);
    expect(typing[0]!.endedAt).not.toBeNull();
    expect(typing[0]!.itemCount).toBe(4);
    expect(typing[0]!.correctCount).toBe(3);
    expect(typing[0]!.detail).toMatchObject({
      wpm: 6,
      accuracy: 0.75,
      correctChars: 15,
      xp: 5,
      elapsedMs: 30_000,
    });

    const today = await db.select().from(dailyActivity);
    expect(today.reduce((a, r) => a + r.xp, 0)).toBe(5);
    expect(today.reduce((a, r) => a + r.reviewsDone, 0)).toBe(0);

    const stats = await loadTypingStats(repos);
    expect(stats.rounds).toBe(1);
    expect(stats.bestWpm).toBe(6); // accuracy 0.75 ≥ 0.7 qualifies
    expect(stats.bestAccuracy).toBe(0); // only 4 words, below the 10-word floor
    expect(await repos.settings.get(SETTING_KEYS.typingStats)).toMatchObject({ v: 1, rounds: 1 });

    // The non-negotiable: no review_log, no card changes.
    const reviewLogAfter = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM review_log`);
    expect(reviewLogAfter[0]!.n).toBe(0);
    const cardsAfter = await db.all<{
      id: string;
      stability: number;
      reps: number;
      due_at: number;
    }>(sql`SELECT id, stability, reps, due_at FROM cards ORDER BY id`);
    expect(cardsAfter).toEqual(cardsBefore);
  });

  it('a zero-word round finishes its session row with no XP, stats, or settings change', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const sessionId = await startTypingRound(repos);
    const res = await finishTypingRound(
      { repos, evaluate: async () => {}, onSessionEnded: async () => {} },
      sessionId,
      [],
      120_000,
    );
    expect(res.xp).toBe(0);
    expect(res.stats.wpm).toBe(0);
    expect(await repos.settings.get(SETTING_KEYS.typingStats)).toBeNull();
    const total = await db.select().from(dailyActivity);
    expect(total).toHaveLength(0);
  });
});
