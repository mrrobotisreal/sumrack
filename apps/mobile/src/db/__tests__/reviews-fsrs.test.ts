import { describe, expect, it } from 'vitest';

import { createBankRepo } from '../repositories/bank';
import { createRepositories } from '../repositories';
import { Rating, State } from '../repositories/reviews';
import { createTestDb } from './helpers';

/** T06: FSRS scheduling logic, card-creation wiring, and distractor queries. */

describe('card creation on bank add (createRepositories wiring)', () => {
  it('addWord creates exactly the active-direction cards (T12 production, T14 listening)', async () => {
    const repos = createRepositories(createTestDb());
    const { item } = await repos.bank.addWord({
      lemma: 'дом',
      surface: 'дом',
      translation: 'house',
    });
    const cards = await repos.reviews.listCardsForItem(item.id);
    expect(cards.map((c) => c.direction).sort()).toEqual([
      'en-ru',
      'listening',
      'production',
      'ru-en',
    ]);
    expect(cards.every((c) => c.state === State.New && c.dueAt <= Date.now())).toBe(true);
  });

  it('addPhrase creates cards too, and deduped re-adds do not duplicate', async () => {
    const repos = createRepositories(createTestDb());
    const first = await repos.bank.addPhrase({ surface: 'до сих пор', translation: 'until now' });
    const again = await repos.bank.addPhrase({ surface: 'до сих пор', translation: 'until now' });
    expect(again.created).toBe(false);
    expect(await repos.reviews.listCardsForItem(first.item.id)).toHaveLength(4);
  });

  it('a deduped add heals an item that predates T06 (no cards yet)', async () => {
    const db = createTestDb();
    const rawBank = createBankRepo(db); // no hook — simulates a pre-T06 write
    const { item } = await rawBank.addWord({ lemma: 'кот', surface: 'кот', translation: 'cat' });
    const repos = createRepositories(db);
    expect(await repos.reviews.listCardsForItem(item.id)).toHaveLength(0);
    await repos.bank.addWord({ lemma: 'кот', surface: 'кота', translation: 'cat' });
    expect(await repos.reviews.listCardsForItem(item.id)).toHaveLength(4);
  });
});

describe('backfillCards', () => {
  it('creates missing active-direction cards for all items, idempotently', async () => {
    const db = createTestDb();
    const rawBank = createBankRepo(db);
    await rawBank.addWord({ lemma: 'ночь', surface: 'ночь', translation: 'night' });
    await rawBank.addWord({ lemma: 'стена', surface: 'стена', translation: 'wall' });
    const repos = createRepositories(db);
    expect(await repos.reviews.backfillCards()).toBe(8);
    expect(await repos.reviews.backfillCards()).toBe(0);
    expect(await repos.reviews.countDueCards()).toBe(8);
  });
});

describe('gradeCard (ts-fsrs pipeline)', () => {
  it('reschedules: Again comes due sooner than Easy', async () => {
    const repos = createRepositories(createTestDb());
    const a = await repos.bank.addWord({ lemma: 'страх', surface: 'страх', translation: 'fear' });
    const b = await repos.bank.addWord({ lemma: 'тьма', surface: 'тьма', translation: 'darkness' });
    const cardA = (await repos.reviews.getCard(a.item.id, 'ru-en'))!;
    const cardB = (await repos.reviews.getCard(b.item.id, 'ru-en'))!;

    const now = Date.now();
    const againResult = await repos.reviews.gradeCard(cardA.id, Rating.Again, { now });
    const easyResult = await repos.reviews.gradeCard(cardB.id, Rating.Easy, { now });

    expect(againResult.card.dueAt).toBeGreaterThan(now);
    expect(easyResult.card.dueAt).toBeGreaterThan(againResult.card.dueAt);
    // Easy graduates straight to Review; Again stays in Learning.
    expect(againResult.card.state).toBe(State.Learning);
    expect(easyResult.card.state).toBe(State.Review);
    // Both leave the due queue for "now".
    expect(await repos.reviews.countDueCards({ now })).toBe(6); // en-ru + production + listening siblings
  });

  it('appends a full ts-fsrs review_log entry per grade', async () => {
    const repos = createRepositories(createTestDb());
    const { item } = await repos.bank.addWord({
      lemma: 'шаг',
      surface: 'шаг',
      translation: 'step',
    });
    const card = (await repos.reviews.getCard(item.id, 'en-ru'))!;

    const t0 = Date.now();
    await repos.reviews.gradeCard(card.id, Rating.Good, { now: t0, durationMs: 2500 });
    const after = (await repos.reviews.getCardById(card.id))!;
    await repos.reviews.gradeCard(card.id, Rating.Again, { now: after.dueAt, durationMs: 9000 });

    const log = await repos.reviews.listReviewLog(card.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      cardId: card.id,
      rating: Rating.Good,
      state: State.New,
      durationMs: 2500,
      reviewedAt: t0,
    });
    expect(log[1]!.rating).toBe(Rating.Again);
    expect(log[1]!.lastElapsedDays).not.toBeNull();

    const final = (await repos.reviews.getCardById(card.id))!;
    expect(final.reps).toBe(2);
    expect(final.lastReviewAt).toBe(after.dueAt);
  });

  it('listReviewLogForItem aggregates across directions, newest first', async () => {
    const repos = createRepositories(createTestDb());
    const { item } = await repos.bank.addWord({
      lemma: 'дверь',
      surface: 'дверь',
      translation: 'door',
    });
    const ruEn = (await repos.reviews.getCard(item.id, 'ru-en'))!;
    const enRu = (await repos.reviews.getCard(item.id, 'en-ru'))!;
    const now = Date.now();
    await repos.reviews.gradeCard(ruEn.id, Rating.Good, { now });
    await repos.reviews.gradeCard(enRu.id, Rating.Hard, { now: now + 1000 });
    const log = await repos.reviews.listReviewLogForItem(item.id);
    expect(log).toHaveLength(2);
    expect(log[0]!.cardId).toBe(enRu.id);
  });
});

describe('due queue', () => {
  it('excludes future cards and honors direction filters', async () => {
    const repos = createRepositories(createTestDb());
    const { item } = await repos.bank.addWord({
      lemma: 'окно',
      surface: 'окно',
      translation: 'window',
    });
    const card = (await repos.reviews.getCard(item.id, 'ru-en'))!;
    const now = Date.now();
    await repos.reviews.gradeCard(card.id, Rating.Easy, { now });

    const due = await repos.reviews.listDueCards({ now });
    expect(due.map((c) => c.direction).sort()).toEqual(['en-ru', 'listening', 'production']);
    expect(await repos.reviews.countDueCards({ now, directions: ['ru-en'] })).toBe(0);
    // The Easy card is due again in the future.
    expect(await repos.reviews.countDueCards({ now: card.dueAt + 30 * 86_400_000 })).toBe(4);
  });

  it('orders most-overdue first', async () => {
    const repos = createRepositories(createTestDb());
    const now = Date.now();
    const a = await repos.bank.addWord({ lemma: 'раз', surface: 'раз', translation: 'time/once' });
    const b = await repos.bank.addWord({ lemma: 'два', surface: 'два', translation: 'two' });
    const cardA = (await repos.reviews.getCard(a.item.id, 'ru-en'))!;
    const cardB = (await repos.reviews.getCard(b.item.id, 'ru-en'))!;
    await repos.reviews.saveCard({ ...cardA, dueAt: now - 1000 });
    await repos.reviews.saveCard({ ...cardB, dueAt: now - 5000 });
    const due = await repos.reviews.listDueCards({ now, directions: ['ru-en'] });
    expect(due.map((c) => c.id)).toEqual([cardB.id, cardA.id]);
  });
});

describe('findDistractors', () => {
  async function seedBank(repos: ReturnType<typeof createRepositories>) {
    const mk = (lemma: string, translation: string, pos: string, level: 'A1' | 'A2') =>
      repos.bank.addWord({ lemma, surface: lemma, translation, pos, level });
    const target = await mk('дом', 'house', 'noun', 'A1');
    await mk('кот', 'cat', 'noun', 'A1');
    await mk('ночь', 'night', 'noun', 'A1');
    await mk('стена', 'wall', 'noun', 'A1');
    await mk('дверь', 'door', 'noun', 'A2');
    await mk('идти', 'to go', 'verb', 'A1');
    await mk('тёмный', 'dark', 'adj', 'A1');
    return target.item;
  }

  it('prefers same-POS same-level items over the rest', async () => {
    const repos = createRepositories(createTestDb());
    const target = await seedBank(repos);
    const distractors = await repos.bank.findDistractors(target, 3);
    expect(distractors).toHaveLength(3);
    for (const d of distractors) {
      expect(d.id).not.toBe(target.id);
      expect(d.pos).toBe('noun');
      expect(d.level).toBe('A1');
    }
  });

  it('falls back through tiers when strict matches run out', async () => {
    const repos = createRepositories(createTestDb());
    const target = await seedBank(repos);
    const five = await repos.bank.findDistractors(target, 5);
    expect(five).toHaveLength(5);
    // First three exhaust the noun/A1 tier; the next is the A2 noun before any verb/adj.
    expect(five.slice(0, 4).every((d) => d.pos === 'noun')).toBe(true);
    expect(new Set(five.map((d) => d.id)).size).toBe(5);
  });

  it('never returns items without a translation', async () => {
    const repos = createRepositories(createTestDb());
    const target = await seedBank(repos);
    await repos.bank.addWord({
      lemma: 'пустой',
      surface: 'пустой',
      translation: '',
      pos: 'noun',
      level: 'A1',
      needsEnrichment: true,
    });
    const distractors = await repos.bank.findDistractors(target, 6);
    expect(distractors.every((d) => d.translation.length > 0)).toBe(true);
  });
});
