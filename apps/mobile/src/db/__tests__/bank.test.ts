import { describe, expect, it } from 'vitest';

import { createBankRepo } from '../repositories/bank';
import { createReviewsRepo } from '../repositories/reviews';
import { createTestDb } from './helpers';

describe('bank repository — dedup rules', () => {
  it('lemma dedup: a second surface form adds an encounter, not a new item', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);

    const first = await bank.addWord({
      lemma: 'слово',
      surface: 'слово',
      translation: 'word',
      sentenceId: 's-1',
    });
    expect(first.created).toBe(true);

    const second = await bank.addWord({
      lemma: 'слово',
      surface: 'словами',
      translation: 'with words',
      sentenceId: 's-2',
    });
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);

    expect(await bank.countItems('word')).toBe(1);
    const item = await bank.getItemWithEncounters(first.item.id);
    expect(item!.encounters).toHaveLength(2);
    expect(item!.encounters.map((e) => e.surface).sort()).toEqual(['словами', 'слово']);
    // Original translation is kept — enrichment/edit is a separate, explicit action.
    expect(item!.translation).toBe('word');
  });

  it('lemma dedup is ё/е-tolerant and case-insensitive', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);

    const withYo = await bank.addWord({ lemma: 'чёрный', surface: 'чёрный', translation: 'black' });
    const withoutYo = await bank.addWord({
      lemma: 'Черный',
      surface: 'черная',
      translation: 'black',
    });
    expect(withoutYo.created).toBe(false);
    expect(withoutYo.item.id).toBe(withYo.item.id);
    // Stored lemma preserves the authored ё (tolerance never mutates text).
    expect(withYo.item.lemma).toBe('чёрный');

    expect((await bank.findWordByLemma('черный'))?.id).toBe(withYo.item.id);
    // T54: the lesson → bank-item resolver (lessons outlive rows → null, never a throw)
    expect((await bank.findByProfileKey('черный', 'word'))?.id).toBe(withYo.item.id);
    expect(await bank.findByProfileKey('черный', 'phrase')).toBeNull();
    expect(await bank.findByProfileKey('нет-такого', 'word')).toBeNull();
  });

  it('phrase dedup keys on normalized text (case, ё, whitespace)', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);

    const a = await bank.addPhrase({ surface: 'Всё в порядке', translation: 'everything is fine' });
    const b = await bank.addPhrase({ surface: 'все  в порядке ', translation: 'all good' });
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(await bank.countItems('phrase')).toBe(1);
    const item = await bank.getItemWithEncounters(a.item.id);
    expect(item!.encounters).toHaveLength(2);
  });

  it('words and phrases dedup independently', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    await bank.addWord({ lemma: 'ночь', surface: 'ночью', translation: 'night' });
    await bank.addPhrase({ surface: 'ночью', translation: 'at night' });
    expect(await bank.countItems()).toBe(2);
  });

  it('deleting an item cascades to encounters and cards, and search filters work', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const reviews = createReviewsRepo(db);

    const added = await bank.addWord({
      lemma: 'стена',
      surface: 'стене',
      translation: 'wall',
      pos: 'noun',
      level: 'A1',
    });
    await reviews.ensureCards(added.item.id);
    expect(await reviews.listCardsForItem(added.item.id)).toHaveLength(4);

    // ё/е-tolerant substring search over the bank
    expect(await bank.listItems({ search: 'стен' })).toHaveLength(1);
    expect(await bank.listItems({ level: 'A1', pos: 'noun' })).toHaveLength(1);
    expect(await bank.listItems({ kind: 'phrase' })).toHaveLength(0);

    await bank.deleteItem(added.item.id);
    expect(await bank.getItemWithEncounters(added.item.id)).toBeNull();
    expect(await reviews.listCardsForItem(added.item.id)).toHaveLength(0);
  });
});
