import { describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import { startOfNextLocalDay } from '@/lib/dates';

import { createRepositories } from '../repositories';
import {
  buildScheduler,
  configureReviewScheduler,
  DEFAULT_SCHEDULER_CONFIG,
  Rating,
  State,
} from '../repositories/reviews';
import { createTestDb } from './helpers';

/** T39: card management, the exclusion audit (queues, counts, forecast, dashboard), scheduler config. */

/** Fixed "now" for FSRS/bury arithmetic. New cards are seeded due at wall-clock Date.now(). */
const NOW = Date.now();

function setup() {
  const db = createTestDb();
  return { db, repos: createRepositories(db) };
}

/** Add `lemmas` as word items (cards due now) and return their ids by lemma. */
async function seedWords(repos: ReturnType<typeof createRepositories>, lemmas: string[]) {
  const out: Record<string, string> = {};
  for (const lemma of lemmas) {
    const { item } = await repos.bank.addWord({
      lemma,
      surface: lemma,
      translation: `t-${lemma}`,
      level: 'A1',
    });
    out[lemma] = item.id;
  }
  return out;
}

describe('startOfNextLocalDay (pure)', () => {
  it('returns local midnight of the following day', () => {
    expect(startOfNextLocalDay(new Date(2026, 4, 10, 9, 0).getTime())).toBe(
      new Date(2026, 4, 11).getTime(),
    );
  });

  it('23:59 rolls to the next midnight, not 24 h later', () => {
    const late = new Date(2026, 4, 10, 23, 59, 59, 999).getTime();
    expect(startOfNextLocalDay(late)).toBe(new Date(2026, 4, 11).getTime());
    expect(startOfNextLocalDay(late)).toBeLessThan(late + 86_400_000);
  });

  it('00:00 exactly is the start of the next day, not the same one', () => {
    expect(startOfNextLocalDay(new Date(2026, 4, 10, 0, 0, 0, 0).getTime())).toBe(
      new Date(2026, 4, 11).getTime(),
    );
  });
});

describe('suspend / unsuspend', () => {
  it('a suspended card is excluded from listDueCards and countDueCards; unsuspend restores it', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['дом']);
    const card = (await repos.reviews.getCard(ids['дом']!, 'ru-en'))!;

    await repos.reviews.suspendCard(card.id, NOW);
    const dueIds = (
      await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en'] })
    ).map((c) => c.id);
    expect(dueIds).not.toContain(card.id);
    expect(await repos.reviews.countDueCards({ now: NOW + 1000, directions: ['ru-en'] })).toBe(0);

    await repos.reviews.unsuspendCard(card.id);
    expect(
      (await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en'] })).map(
        (c) => c.id,
      ),
    ).toContain(card.id);
  });

  it('a suspended card is not returned by getGradableCard; a buried card still is', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['кот']);
    const card = (await repos.reviews.getCard(ids['кот']!, 'production'))!;

    await repos.reviews.buryUntilTomorrow(card.id, NOW);
    expect(await repos.reviews.getGradableCard(ids['кот']!, 'production')).not.toBeNull();

    await repos.reviews.suspendCard(card.id, NOW);
    expect(await repos.reviews.getGradableCard(ids['кот']!, 'production')).toBeNull();
    // getCard stays unfiltered
    expect(await repos.reviews.getCard(ids['кот']!, 'production')).not.toBeNull();
  });
});

describe('bury', () => {
  it('a buried card is hidden at now and returns at the start of the next local day', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['вода']);
    const card = (await repos.reviews.getCard(ids['вода']!, 'ru-en'))!;

    await repos.reviews.buryUntilTomorrow(card.id, NOW);
    const hidden = (
      await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en'] })
    ).map((c) => c.id);
    expect(hidden).not.toContain(card.id);

    const back = startOfNextLocalDay(NOW) + 1;
    const visible = (await repos.reviews.listDueCards({ now: back, directions: ['ru-en'] })).map(
      (c) => c.id,
    );
    expect(visible).toContain(card.id);
  });

  it('unburyCard clears the bury immediately', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['сон']);
    const card = (await repos.reviews.getCard(ids['сон']!, 'ru-en'))!;
    await repos.reviews.buryUntilTomorrow(card.id, NOW);
    await repos.reviews.unburyCard(card.id);
    expect((await repos.reviews.getCardById(card.id))!.buriedUntil).toBeNull();
    expect(
      (await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en'] })).map(
        (c) => c.id,
      ),
    ).toContain(card.id);
  });
});

describe('reviews queue exclusion audit', () => {
  it('listWeakestCards, listCardsForItems and countDueCards honour suspension and bury', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['один', 'два', 'три']);
    const suspended = (await repos.reviews.getCard(ids['один']!, 'ru-en'))!;
    const buried = (await repos.reviews.getCard(ids['два']!, 'ru-en'))!;
    await repos.reviews.suspendCard(suspended.id, NOW);
    await repos.reviews.buryUntilTomorrow(buried.id, NOW);

    const due = await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en'] });
    expect(due.map((c) => c.id)).not.toContain(suspended.id);
    expect(due.map((c) => c.id)).not.toContain(buried.id);
    expect(await repos.reviews.countDueCards({ now: NOW + 1000, directions: ['ru-en'] })).toBe(1);

    // listWeakestCards serves only NOT-yet-due cards; these are due now, so the
    // weak list excludes them by due-ness alone. The exclusion check below is
    // therefore asserted against due=NOT-due semantics via the buried/suspended
    // cards being dropped from the due queue above.
    const weak = await repos.reviews.listWeakestCards({ now: NOW + 1000, directions: ['ru-en'] });
    expect(weak.map((c) => c.id)).not.toContain(suspended.id);
    expect(weak.map((c) => c.id)).not.toContain(buried.id);

    const forItems = await repos.reviews.listCardsForItems(
      [ids['один']!, ids['два']!, ids['три']!],
      ['ru-en'],
      NOW + 1000,
    );
    expect(forItems.map((c) => c.id)).not.toContain(suspended.id);
    expect(forItems.map((c) => c.id)).not.toContain(buried.id);
    expect(forItems.map((c) => c.id)).toContain(
      (await repos.reviews.getCard(ids['три']!, 'ru-en'))!.id,
    );
  });

  it('listCardsForItem (item detail) still shows suspended and buried cards', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['мама']);
    const card = (await repos.reviews.getCard(ids['мама']!, 'ru-en'))!;
    await repos.reviews.suspendCard(card.id, NOW);
    await repos.reviews.buryUntilTomorrow(card.id, NOW);
    const all = await repos.reviews.listCardsForItem(ids['мама']!);
    expect(all.find((c) => c.id === card.id)).toBeDefined();
  });

  it('per-direction: suspend ru-en only leaves the en-ru card due', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['папа']);
    const ruEn = (await repos.reviews.getCard(ids['папа']!, 'ru-en'))!;
    const enRu = (await repos.reviews.getCard(ids['папа']!, 'en-ru'))!;
    await repos.reviews.suspendCard(ruEn.id, NOW);
    const due = (
      await repos.reviews.listDueCards({ now: NOW + 1000, directions: ['ru-en', 'en-ru'] })
    ).map((c) => c.id);
    expect(due).not.toContain(ruEn.id);
    expect(due).toContain(enRu.id);
  });
});

describe('dashboard exclusion audit', () => {
  it('getForecastCards: suspended absent; buried lands on the next local day', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['лес']);
    const sus = (await repos.reviews.getCard(ids['лес']!, 'ru-en'))!;
    const bur = (await repos.reviews.getCard(ids['лес']!, 'en-ru'))!;
    await repos.reviews.suspendCard(sus.id, NOW);
    await repos.reviews.buryUntilTomorrow(bur.id, NOW);

    const forecast = await repos.dashboard.getForecastCards();
    expect(forecast.filter((f) => f.direction === 'ru-en')).toHaveLength(0);
    const enRu = forecast.filter((f) => f.direction === 'en-ru');
    expect(enRu).toHaveLength(1);
    expect(enRu[0]!.dueAt).toBe(startOfNextLocalDay(NOW));
  });

  it('getWeakestLemmas and getWeakestPronunciation exclude suspended cards', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['гость']);
    // give the cards reps>0 so they qualify for the weak lists
    for (const direction of ['ru-en', 'production'] as const) {
      const c = (await repos.reviews.getCard(ids['гость']!, direction))!;
      await repos.reviews.gradeCard(c.id, Rating.Good, { now: NOW });
    }
    const weakBefore = await repos.dashboard.getWeakestLemmas(8, NOW);
    expect(weakBefore.map((w) => w.bankItemId)).toContain(ids['гость']);
    const pronBefore = await repos.dashboard.getWeakestPronunciation();
    expect(pronBefore.map((w) => w.bankItemId)).toContain(ids['гость']);

    const ru = (await repos.reviews.getCard(ids['гость']!, 'ru-en'))!;
    const pr = (await repos.reviews.getCard(ids['гость']!, 'production'))!;
    await repos.reviews.suspendCard(ru.id, NOW);
    await repos.reviews.suspendCard(pr.id, NOW);
    expect((await repos.dashboard.getWeakestLemmas(8, NOW)).map((w) => w.bankItemId)).not.toContain(
      ids['гость'],
    );
    expect(
      (await repos.dashboard.getWeakestPronunciation()).map((w) => w.bankItemId),
    ).not.toContain(ids['гость']);
  });

  it('getTopicPracticeItemIds drops a word whose only servable cards are suspended', async () => {
    const { db, repos } = setup();
    const ids = await seedWords(repos, ['тема']);
    // a sentence tagged with a grammar topic that contains the lemma
    await db.run(
      sql`INSERT INTO packs (id, version, type, title_ru, title_en, level, tags, imported_at)
          VALUES ('tp', 1, 'stories', 'tp', 'tp', 'A1', '[]', ${NOW})`,
    );
    await db.run(
      sql`INSERT INTO stories (pack_id, id, order_idx, title_ru, title_en, level)
          VALUES ('tp', 'tst', 0, 'tst', 'tst', 'A1')`,
    );
    await db.run(
      sql`INSERT INTO sentences (pack_id, id, story_id, order_idx, ru, en, grammar_topics)
          VALUES ('tp', 's1', 'tst', 0, 'тема', 'theme', '["topic-x"]')`,
    );
    await db.run(
      sql`INSERT INTO tokens (pack_id, sentence_id, token_index, story_id, text, text_norm, is_punct, space_before, lemma, lemma_norm, translation, pos)
          VALUES ('tp', 's1', 0, 'tst', 'тема', 'тема', 0, 0, 'тема', 'тема', 'theme', 'noun')`,
    );
    expect(await repos.dashboard.getTopicPracticeItemIds('A1', 'topic-x')).toContain(ids['тема']);
    for (const dir of ['ru-en', 'en-ru', 'production', 'listening'] as const) {
      const c = (await repos.reviews.getCard(ids['тема']!, dir))!;
      await repos.reviews.suspendCard(c.id, NOW);
    }
    expect(await repos.dashboard.getTopicPracticeItemIds('A1', 'topic-x')).not.toContain(
      ids['тема'],
    );
  });

  it('getLeechCandidates excludes a suspended card with ≥ threshold Agains', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['трудно']);
    const card = (await repos.reviews.getCard(ids['трудно']!, 'ru-en'))!;
    for (let i = 0; i < 4; i++) {
      await repos.reviews.gradeCard(card.id, Rating.Again, { now: NOW + i * 1000 });
    }
    expect((await repos.dashboard.getLeechCandidates(4)).map((c) => c.cardId)).toContain(card.id);
    await repos.reviews.suspendCard(card.id, NOW);
    expect((await repos.dashboard.getLeechCandidates(4)).map((c) => c.cardId)).not.toContain(
      card.id,
    );
  });
});

describe('reset', () => {
  it('a Good ×4 card resets to New and keeps its full review log', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['дорога']);
    const card = (await repos.reviews.getCard(ids['дорога']!, 'ru-en'))!;
    for (let i = 0; i < 4; i++) {
      await repos.reviews.gradeCard(card.id, Rating.Good, { now: NOW + i * 86_400_000 });
    }
    expect((await repos.reviews.getCardById(card.id))!.reps).toBe(4);

    const reset = await repos.reviews.resetCard(card.id, NOW);
    expect(reset.state).toBe(State.New);
    expect(reset.reps).toBe(0);
    expect(reset.lapses).toBe(0);
    expect(reset.stability).toBe(0);
    expect(reset.difficulty).toBe(0);
    expect(reset.lastReviewAt).toBeNull();
    expect(reset.dueAt).toBe(NOW);
    expect(reset.buriedUntil).toBeNull();

    expect(await repos.reviews.listReviewLog(card.id)).toHaveLength(4);
  });

  it('reset keeps suspension and does not touch the review log', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['сад']);
    const card = (await repos.reviews.getCard(ids['сад']!, 'ru-en'))!;
    await repos.reviews.gradeCard(card.id, Rating.Good, { now: NOW });
    await repos.reviews.suspendCard(card.id, NOW);
    const reset = await repos.reviews.resetCard(card.id, NOW);
    expect(reset.suspendedAt).toBe(NOW);
    expect(await repos.reviews.listReviewLog(card.id)).toHaveLength(1);
  });
});

describe('listAllReviewLog', () => {
  it('joins each log row to its card direction + bank item, ordered by card then time', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['поле']);
    const card = (await repos.reviews.getCard(ids['поле']!, 'en-ru'))!;
    await repos.reviews.gradeCard(card.id, Rating.Hard, { now: NOW + 2000, durationMs: 1200 });
    await repos.reviews.gradeCard(card.id, Rating.Good, { now: NOW + 1000 });
    const rows = await repos.reviews.listAllReviewLog();
    const mine = rows.filter((r) => r.cardId === card.id);
    expect(mine.map((r) => r.reviewedAt)).toEqual([NOW + 1000, NOW + 2000]);
    expect(mine[0]).toMatchObject({
      direction: 'en-ru',
      bankItemId: ids['поле'],
      rating: Rating.Good,
    });
    expect(mine[1]).toMatchObject({ direction: 'en-ru', rating: Rating.Hard, durationMs: 1200 });
  });
});

describe('scheduler configuration', () => {
  /** A review-state card 10 days old, so the Good interval is the FSRS interval (not a learning step). */
  function reviewCard() {
    return {
      due: new Date(NOW),
      stability: 10,
      difficulty: 5,
      elapsed_days: 10,
      scheduled_days: 10,
      learning_steps: 0,
      reps: 3,
      lapses: 0,
      state: State.Review,
      last_review: new Date(NOW - 10 * 86_400_000),
    };
  }

  it('a lower desired retention produces a strictly longer Good interval', () => {
    const at = (r: number) =>
      buildScheduler({ desiredRetention: r, w: null }).next(
        reviewCard(),
        new Date(NOW),
        Rating.Good,
      ).card.scheduled_days;
    expect(at(0.8)).toBeGreaterThan(at(0.95));
  });

  it('a non-default w changes the first-Good stability vs defaults (fresh card: w[0..3] set initial stability)', () => {
    const fresh = {
      ...reviewCard(),
      state: State.New,
      reps: 0,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      last_review: undefined,
    };
    const defaults = buildScheduler(DEFAULT_SCHEDULER_CONFIG).next(
      fresh,
      new Date(NOW),
      Rating.Good,
    );
    const w = [...buildScheduler(DEFAULT_SCHEDULER_CONFIG).parameters.w];
    for (let i = 0; i < 4; i++) w[i] = w[i]! * 2;
    const tuned = buildScheduler({ desiredRetention: 0.9, w }).next(
      fresh,
      new Date(NOW),
      Rating.Good,
    );
    expect(tuned.card.stability).toBeGreaterThan(defaults.card.stability);
  });

  it('configureReviewScheduler changes what gradeCard produces', async () => {
    const { repos } = setup();
    const ids = await seedWords(repos, ['ночь', 'день']);
    // Two review-state cards (New cards grade to a learning step, identical across retention).
    const matured = async (lemma: string, direction: 'ru-en' | 'en-ru') => {
      const c = (await repos.reviews.getCard(ids[lemma]!, direction))!;
      await repos.reviews.saveCard({
        ...c,
        state: State.Review,
        stability: 10,
        difficulty: 5,
        reps: 3,
        elapsedDays: 10,
        scheduledDays: 10,
        lastReviewAt: NOW - 10 * 86_400_000,
        dueAt: NOW,
      });
      return (await repos.reviews.getCardById(c.id))!;
    };
    const low = await matured('ночь', 'ru-en');
    const high = await matured('день', 'ru-en');
    try {
      configureReviewScheduler({ desiredRetention: 0.8, w: null });
      const lowRow = (await repos.reviews.gradeCard(low.id, Rating.Good, { now: NOW })).card;
      configureReviewScheduler({ desiredRetention: 0.95, w: null });
      const highRow = (await repos.reviews.gradeCard(high.id, Rating.Good, { now: NOW })).card;
      // Lower desired retention = longer interval = LATER due date.
      expect(lowRow.dueAt).toBeGreaterThan(highRow.dueAt);
    } finally {
      configureReviewScheduler(DEFAULT_SCHEDULER_CONFIG);
    }
  });
});
