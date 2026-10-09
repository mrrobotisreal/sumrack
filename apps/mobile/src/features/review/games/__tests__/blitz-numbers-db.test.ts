import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { cards, dailyActivity, reviewLog } from '@/db/schema';
import type { SumrakDB } from '@/db/types';

import {
  BLITZ_DURATION_MS,
  createBoard,
  dedupePool,
  remainingMs,
  shortGloss,
  tryMatch,
  VISIBLE_PAIRS,
  WRONG_PENALTY_MS,
  xpForBlitz,
  type BlitzPair,
} from '../blitz/engine';
import { finishBlitzRound, loadBlitzPool, loadBlitzStats, startBlitzRound } from '../blitz/service';
import { DEFAULT_BLITZ_STATS, mergeBlitzStats, parseBlitzStats } from '../blitz/stats';
import type { NumbersAttempt } from '../numbers/engine';
import { finishNumbersRound, loadNumbersStats, startNumbersRound } from '../numbers/service';

/**
 * T34 — the two FSRS-free games against a real migrated DB: blitz sourcing
 * (young+mature only), board refill invariants, the zero-review_log proof,
 * best-score persistence; numbers band tallies in game_sessions.detail and
 * the pure aggregator.
 */

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function seedWord(
  db: SumrakDB,
  repos: ReturnType<typeof createRepositories>,
  lemma: string,
  stability: number | null,
  translation = `en-${lemma}`,
): Promise<string> {
  const { item } = await repos.bank.addWord({ lemma, surface: lemma, translation });
  if (stability != null) {
    await db
      .update(cards)
      .set({ stability, reps: 2 })
      .where(sql`${cards.bankItemId} = ${item.id} AND ${cards.direction} IN ('ru-en','en-ru')`);
  }
  return item.id;
}

const noop = async () => {};

describe('blitz pool (young + mature only)', () => {
  it('includes stability ≥ 7 weakest-link words, excludes shaky / unreviewed / phrases', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedWord(db, repos, 'дом', 40);
    await seedWord(db, repos, 'кот', 7);
    await seedWord(db, repos, 'лес', 6.9);
    await seedWord(db, repos, 'нож', null);
    await repos.bank.addPhrase({ surface: 'как дела', translation: 'how are you' });
    const pool = await loadBlitzPool(repos);
    expect(pool.map((p) => p.ru).sort()).toEqual(['дом', 'кот']);
  });

  it('dedupes lemma/gloss collisions and shortens glosses to the first sense', () => {
    const pool = dedupePool([
      { id: 'a', ru: 'дом', en: 'house' },
      { id: 'b', ru: 'здание', en: 'House' },
      { id: 'c', ru: 'Дом', en: 'home' },
      { id: 'd', ru: 'лес', en: 'forest' },
    ]);
    expect(pool.map((p) => p.id)).toEqual(['a', 'd']);
    expect(shortGloss('to go; to walk (on foot)')).toBe('to go');
  });
});

describe('blitz board', () => {
  const pool: BlitzPair[] = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    ru: `ру${i}`,
    en: `en${i}`,
  }));
  const ids = pool.map((p) => p.id);

  it('starts with VISIBLE_PAIRS pairs, same ids on both sides', () => {
    const board = createBoard(pool, seeded(1));
    expect(board.left).toHaveLength(VISIBLE_PAIRS);
    expect(new Set(board.left)).toEqual(new Set(board.right));
  });

  it('a match refills both vacated slots in place; other tiles never move', () => {
    let board = createBoard(pool, seeded(2));
    const rng = seeded(3);
    for (let round = 0; round < 40; round++) {
      const leftSlot = round % VISIBLE_PAIRS;
      const id = board.left[leftSlot]!;
      const rightSlot = board.right.indexOf(id);
      const out = tryMatch(board, leftSlot, rightSlot, ids, rng);
      expect(out.kind).toBe('match');
      if (out.kind !== 'match') return;
      for (let s = 0; s < VISIBLE_PAIRS; s++) {
        if (s !== leftSlot) expect(out.board.left[s]).toBe(board.left[s]);
        if (s !== rightSlot) expect(out.board.right[s]).toBe(board.right[s]);
      }
      // Board stays a permutation pair with no duplicates.
      expect(new Set(out.board.left).size).toBe(VISIBLE_PAIRS);
      expect(new Set(out.board.left)).toEqual(new Set(out.board.right));
      expect(out.board.left[leftSlot]).not.toBe(id);
      board = out.board;
    }
  });

  it('a wrong pair is a miss and leaves the board unchanged', () => {
    const board = createBoard(pool, seeded(4));
    const wrongRight = board.right.findIndex((r) => r !== board.left[0]);
    expect(tryMatch(board, 0, wrongRight, ids)).toEqual({ kind: 'miss' });
  });

  it('clock + penalty + XP brackets', () => {
    expect(remainingMs(0, 0)).toBe(BLITZ_DURATION_MS);
    expect(remainingMs(10_000, 3 * WRONG_PENALTY_MS)).toBe(44_000);
    expect(remainingMs(59_000, WRONG_PENALTY_MS)).toBe(0);
    expect([0, 1, 9, 10, 19, 20, 29, 30, 50].map(xpForBlitz)).toEqual([
      0, 5, 5, 10, 10, 15, 15, 20, 20,
    ]);
  });
});

describe('blitz service — FSRS-free', () => {
  it('a full sprint writes zero review_log rows, leaves cards untouched, stores game_sessions + best', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    for (const w of ['дом', 'кот', 'лес', 'нож', 'окно', 'стол', 'вода'])
      await seedWord(db, repos, w, 30);
    const cardsBefore = await db.select().from(cards);
    const logBefore = await db.select().from(reviewLog);

    const pool = await loadBlitzPool(repos);
    const id = await startBlitzRound(repos, pool.length);
    const res = await finishBlitzRound(
      { repos, evaluate: noop, onSessionEnded: noop, now: () => 1000 },
      id,
      { pairs: 22, misses: 3, penaltyMs: 6000, poolSize: pool.length, completed: true },
    );
    expect(res).toEqual({ pairs: 22, xp: 15, best: 22, newBest: true });

    expect(await db.select().from(reviewLog)).toEqual(logBefore);
    expect(logBefore).toHaveLength(0);
    expect(await db.select().from(cards)).toEqual(cardsBefore);

    const [session] = await repos.stats.listFinishedGameSessions('match-blitz');
    expect(session).toMatchObject({ mode: 'match-blitz', itemCount: 25, correctCount: 22 });
    expect(session!.detail).toMatchObject({
      score: 22,
      misses: 3,
      penaltyMs: 6000,
      completed: true,
      xp: 15,
    });
    const [day] = await db.select().from(dailyActivity);
    expect(day!.xp).toBe(15);
    expect(day!.reviewsDone).toBe(0);
    expect((await loadBlitzStats(repos)).best).toBe(22);

    // A lower sprint keeps the best; a quit sprint moves no stats and no XP.
    const id2 = await startBlitzRound(repos, pool.length);
    const res2 = await finishBlitzRound({ repos, evaluate: noop, onSessionEnded: noop }, id2, {
      pairs: 5,
      misses: 0,
      penaltyMs: 0,
      poolSize: pool.length,
      completed: true,
    });
    expect(res2).toMatchObject({ best: 22, newBest: false, xp: 5 });
    const id3 = await startBlitzRound(repos, pool.length);
    const res3 = await finishBlitzRound({ repos, evaluate: noop, onSessionEnded: noop }, id3, {
      pairs: 40,
      misses: 0,
      penaltyMs: 0,
      poolSize: pool.length,
      completed: false,
    });
    expect(res3).toMatchObject({ xp: 0, best: 22, newBest: false });
    expect((await loadBlitzStats(repos)).rounds).toBe(2);
  });

  it('stats heal corrupt values and merge', async () => {
    expect(parseBlitzStats({ v: 2 })).toEqual(DEFAULT_BLITZ_STATS);
    expect(parseBlitzStats('nonsense')).toEqual(DEFAULT_BLITZ_STATS);
    expect(mergeBlitzStats(DEFAULT_BLITZ_STATS, 0, 1)).toBe(DEFAULT_BLITZ_STATS);
    const db = createTestDb();
    const repos = createRepositories(db);
    await repos.settings.set(SETTING_KEYS.blitzStats, { garbage: true });
    expect(await loadBlitzStats(repos)).toEqual(DEFAULT_BLITZ_STATS);
  });
});

describe('numbers service — detail + aggregator', () => {
  const attempt = (band: NumbersAttempt['band'], correct: boolean, plays = 1): NumbersAttempt => ({
    band,
    kind: band === 'price' ? 'price' : 'number',
    correct,
    plays,
  });

  it('a complete round stores band tallies, earns XP, never touches review_log', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const id = await startNumbersRound(repos, 3);
    const attempts = [
      ...Array.from({ length: 6 }, () => attempt('101-1000', true)),
      attempt('101-1000', false, 3),
      attempt('price', true),
      attempt('price', false),
      attempt('price', true, 2),
    ];
    const res = await finishNumbersRound(
      { repos, evaluate: noop, onSessionEnded: noop },
      id,
      3,
      attempts,
    );
    expect(res).toMatchObject({ correct: 8, total: 10, xp: 13, completed: true });
    expect(await db.select().from(reviewLog)).toHaveLength(0);

    const [row] = await repos.stats.listFinishedGameSessions('numbers');
    expect(row!.detail).toEqual({
      tier: 3,
      bands: { '101-1000': { seen: 7, correct: 6 }, price: { seen: 3, correct: 2 } },
      completed: true,
      replays: 3,
      xp: 13,
    });

    const stats = await loadNumbersStats(repos);
    expect(stats.rounds).toBe(1);
    expect(stats.bands.price).toEqual({ seen: 3, correct: 2 });
    expect(stats.suggested).toBe(4); // 80 % at tier 3 → promote
  });

  it('a partial (quit) round keeps its tallies, earns nothing, is not a completed round', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const id = await startNumbersRound(repos, 1);
    const res = await finishNumbersRound({ repos, evaluate: noop, onSessionEnded: noop }, id, 1, [
      attempt('0-20', true),
    ]);
    expect(res).toMatchObject({ xp: 0, completed: false });
    const stats = await loadNumbersStats(repos);
    expect(stats.rounds).toBe(0);
    expect(stats.bands['0-20']).toEqual({ seen: 1, correct: 1 });
    expect(await db.select().from(dailyActivity)).toHaveLength(0);
  });

  it('ignores foreign-shaped detail rows', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const row = await repos.stats.startGameSession('numbers');
    await repos.stats.finishGameSession(row.id, {
      itemCount: 10,
      correctCount: 10,
      detail: { tier: 9 },
    });
    const stats = await loadNumbersStats(repos);
    expect(stats.rounds).toBe(0);
    expect(stats.suggested).toBe(1);
  });
});
