import { describe, expect, it } from 'vitest';

import { createRepositories } from '../repositories';
import { createStatsRepo } from '../repositories/stats';
import { createTestDb } from './helpers';

/** T19: goal-met stamping, freeze coverage, XP totals, mastery count. */
describe('stats repo — motivation additions (T19)', () => {
  it('bumpDailyActivity accumulates xp alongside counters', async () => {
    const stats = createStatsRepo(createTestDb());
    await stats.bumpDailyActivity({ reviewsDone: 1, xp: 3 }, '2026-08-22');
    await stats.bumpDailyActivity({ xp: 15 }, '2026-08-22');
    await stats.bumpDailyActivity({ xp: 7 }, '2026-08-21');
    const row = await stats.getDailyActivity('2026-08-22');
    expect(row?.xp).toBe(18);
    expect(await stats.getTotalXp()).toBe(25);
  });

  it('markGoalMet stamps exactly once and only when the day has a row', async () => {
    const stats = createStatsRepo(createTestDb());
    expect(await stats.markGoalMet('2026-08-22')).toBe(false); // no activity row yet
    await stats.bumpDailyActivity({ reviewsDone: 20 }, '2026-08-22');
    expect(await stats.markGoalMet('2026-08-22')).toBe(true);
    expect(await stats.markGoalMet('2026-08-22')).toBe(false); // one-way door
    const row = await stats.getDailyActivity('2026-08-22');
    expect(row?.goalMetAt).toBeTypeOf('number');
  });

  it('getStreakDays returns met + frozen sets; insertFrozenDays is idempotent', async () => {
    const stats = createStatsRepo(createTestDb());
    await stats.bumpDailyActivity({ reviewsDone: 1 }, '2026-08-20');
    await stats.markGoalMet('2026-08-20');
    await stats.bumpDailyActivity({ reviewsDone: 1 }, '2026-08-21'); // active but goal not met
    await stats.insertFrozenDays(['2026-08-21']);
    await stats.insertFrozenDays(['2026-08-21']); // duplicate — no throw
    const days = await stats.getStreakDays();
    expect([...days.met]).toEqual(['2026-08-20']);
    expect([...days.frozen]).toEqual(['2026-08-21']);
    expect(await stats.listFrozenDays()).toHaveLength(1);
  });

  it('countMasteredLemmas: MIN reviewed core stability ≥ 30, words only', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);

    const mature = await repos.bank.addWord({
      lemma: 'дом',
      surface: 'дом',
      translation: 'house',
    });
    const shaky = await repos.bank.addWord({
      lemma: 'стена',
      surface: 'стена',
      translation: 'wall',
    });
    await repos.bank.addPhrase({ surface: 'всё в порядке', translation: 'all good' });

    expect(await repos.reviews.countMasteredLemmas()).toBe(0); // nothing reviewed

    // Mature item: both core cards reviewed with high stability.
    for (const card of await repos.reviews.listCardsForItem(mature.item.id)) {
      if (card.direction === 'ru-en' || card.direction === 'en-ru') {
        await repos.reviews.saveCard({ ...card, reps: 3, stability: 40 });
      }
    }
    // Shaky item: one core card young — MIN drags it under the bar.
    for (const card of await repos.reviews.listCardsForItem(shaky.item.id)) {
      if (card.direction === 'ru-en')
        await repos.reviews.saveCard({ ...card, reps: 3, stability: 45 });
      if (card.direction === 'en-ru')
        await repos.reviews.saveCard({ ...card, reps: 2, stability: 5 });
    }

    expect(await repos.reviews.countMasteredLemmas()).toBe(1);
  });
});
