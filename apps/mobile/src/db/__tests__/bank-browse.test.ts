import { describe, expect, it } from 'vitest';

import { createBankRepo } from '../repositories/bank';
import { createTestDb } from './helpers';

/** T05: the Словарь browse surface — encounter counts and filter options. */
describe('bank repository — browse (T05)', () => {
  async function seed(bank = createBankRepo(createTestDb())) {
    await bank.addWord({
      lemma: 'чёрный',
      surface: 'чёрный',
      translation: 'black',
      pos: 'adj',
      level: 'A1',
      sentenceId: 's-1',
      sourceStoryId: 'story-a',
    });
    // Second encounter for the same lemma, е-spelled.
    await bank.addWord({
      lemma: 'черный',
      surface: 'черная',
      translation: 'black',
      sentenceId: 's-2',
      sourceStoryId: 'story-a',
    });
    await bank.addWord({
      lemma: 'стена',
      surface: 'стене',
      translation: 'wall',
      pos: 'noun',
      level: 'A2',
      sentenceId: 's-3',
      sourceStoryId: 'story-b',
    });
    await bank.addPhrase({ surface: 'всё в порядке', translation: 'all good' });
    return bank;
  }

  it('listItems carries an encounter count per item', async () => {
    const bank = await seed();
    const items = await bank.listItems();
    const black = items.find((i) => i.lemma === 'чёрный');
    const wall = items.find((i) => i.lemma === 'стена');
    expect(black?.encounterCount).toBe(2);
    expect(wall?.encounterCount).toBe(1);
  });

  it('search finds the same item from both ё and е spellings', async () => {
    const bank = await seed();
    const withYo = await bank.listItems({ search: 'чёрн' });
    const withoutYo = await bank.listItems({ search: 'черн' });
    expect(withYo).toHaveLength(1);
    expect(withoutYo).toHaveLength(1);
    expect(withYo[0]!.id).toBe(withoutYo[0]!.id);
  });

  it('filters compose: kind, level, pos, source story', async () => {
    const bank = await seed();
    expect(await bank.listItems({ kind: 'phrase' })).toHaveLength(1);
    expect((await bank.listItems({ level: 'A2' }))[0]!.lemma).toBe('стена');
    expect((await bank.listItems({ pos: 'adj' }))[0]!.lemma).toBe('чёрный');
    expect(await bank.listItems({ sourceStoryId: 'story-a' })).toHaveLength(1);
    expect(await bank.listItems({ kind: 'word', level: 'A1', pos: 'noun' })).toHaveLength(0);
  });

  it('getFilterOptions returns only values present, levels in CEFR order', async () => {
    const bank = await seed();
    const opts = await bank.getFilterOptions();
    expect(opts.pos).toEqual(['adj', 'noun']);
    expect(opts.levels).toEqual(['A1', 'A2']);
    expect(opts.sourceStoryIds.sort()).toEqual(['story-a', 'story-b']);
  });

  it('manual add (no source) yields an encounter with no sentence/journal ref', async () => {
    const bank = createBankRepo(createTestDb());
    const result = await bank.addWord({ lemma: 'привет', surface: 'привет', translation: 'hi' });
    expect(result.encounter.sentenceId).toBeNull();
    expect(result.encounter.journalEntryId).toBeNull();
    const items = await bank.listItems();
    expect(items[0]!.sourceStoryId).toBeNull();
  });
});
