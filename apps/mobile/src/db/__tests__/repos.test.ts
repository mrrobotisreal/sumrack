import { describe, expect, it } from 'vitest';

import { createBankRepo } from '../repositories/bank';
import { createReviewsRepo } from '../repositories/reviews';
import { createSettingsRepo, SETTING_KEYS } from '../repositories/settings';
import { createStatsRepo, localDateKey } from '../repositories/stats';
import { createSyncStateRepo } from '../repositories/sync-state';
import { createTestDb } from './helpers';

describe('settings repository', () => {
  it('round-trips JSON values and upserts', async () => {
    const db = createTestDb();
    const settings = createSettingsRepo(db);
    expect(await settings.get(SETTING_KEYS.themeMode)).toBeNull();
    await settings.set(SETTING_KEYS.themeMode, 'dark');
    await settings.set(SETTING_KEYS.themeMode, 'system');
    expect(await settings.get<string>(SETTING_KEYS.themeMode)).toBe('system');
    await settings.set('complex', { a: 1, b: ['x', 'y'] });
    expect(await settings.get('complex')).toEqual({ a: 1, b: ['x', 'y'] });
    await settings.remove('complex');
    expect(await settings.get('complex')).toBeNull();
  });
});

describe('reviews repository (shape only — logic is T06)', () => {
  it('ensureCards creates one card per direction, idempotently, in ts-fsrs New state', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const reviews = createReviewsRepo(db);

    const { item } = await bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    const first = await reviews.ensureCards(item.id, ['ru-en', 'en-ru']);
    expect(first).toHaveLength(2);
    const again = await reviews.ensureCards(item.id, ['ru-en', 'en-ru', 'listening']);
    expect(again).toHaveLength(3);

    const card = await reviews.getCard(item.id, 'ru-en');
    expect(card).toMatchObject({ state: 0, reps: 0, lapses: 0, stability: 0 });
    expect(card!.dueAt).toBeLessThanOrEqual(Date.now());
  });

  it('due query + review log round-trip', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const reviews = createReviewsRepo(db);
    const { item } = await bank.addWord({ lemma: 'кот', surface: 'кот', translation: 'cat' });
    await reviews.ensureCards(item.id);

    expect(await reviews.countDueCards()).toBe(2);
    const due = await reviews.listDueCards();
    expect(due).toHaveLength(2);

    const card = due[0]!;
    await reviews.saveCard({ ...card, dueAt: Date.now() + 86_400_000, reps: 1, state: 1 });
    expect(await reviews.countDueCards()).toBe(1);

    await reviews.appendReviewLog({
      cardId: card.id,
      rating: 3,
      state: 0,
      dueAt: card.dueAt,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reviewedAt: Date.now(),
      durationMs: 2500,
    });
    expect(await reviews.listReviewLog(card.id)).toHaveLength(1);
  });
});

describe('stats repository', () => {
  it('bumpDailyActivity upserts and increments per-day counters', async () => {
    const db = createTestDb();
    const stats = createStatsRepo(db);
    await stats.bumpDailyActivity({ reviewsDone: 5 });
    await stats.bumpDailyActivity({ reviewsDone: 3, readingMs: 60_000 });
    const today = await stats.getDailyActivity();
    expect(today).toMatchObject({ reviewsDone: 8, readingMs: 60_000, storiesFinished: 0 });
    expect(today!.date).toBe(localDateKey());
  });

  it('game sessions, achievements, and analytics events persist', async () => {
    const db = createTestDb();
    const stats = createStatsRepo(db);

    const session = await stats.startGameSession('flashcards');
    await stats.finishGameSession(session.id, { itemCount: 20, correctCount: 17 });
    const sessions = await stats.listGameSessions();
    expect(sessions[0]).toMatchObject({ mode: 'flashcards', itemCount: 20, correctCount: 17 });
    expect(sessions[0]!.endedAt).not.toBeNull();

    expect(await stats.unlockAchievement('first-story')).toBe(true);
    expect(await stats.unlockAchievement('first-story')).toBe(false);
    expect(await stats.listAchievements()).toHaveLength(1);

    await stats.logEvent('app_opened');
    await stats.logEvent('story_finished', { storyId: 'knock-in-the-wall', minutes: 7 });
    const events = await stats.listRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.props).toEqual({ storyId: 'knock-in-the-wall', minutes: 7 });
  });
});

describe('sync-state repository', () => {
  it('records, upserts, and removes installed packs', async () => {
    const db = createTestDb();
    const syncStateRepo = createSyncStateRepo(db);
    await syncStateRepo.recordInstalled('p1', 1, 'bundled');
    await syncStateRepo.recordInstalled('p1', 2, 'github');
    expect(await syncStateRepo.getInstalled('p1')).toMatchObject({ version: 2, source: 'github' });
    expect(await syncStateRepo.listInstalled()).toHaveLength(1);
    await syncStateRepo.removeInstalled('p1');
    expect(await syncStateRepo.getInstalled('p1')).toBeNull();
  });
});
