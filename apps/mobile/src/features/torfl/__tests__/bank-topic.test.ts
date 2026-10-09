import { describe, expect, it } from 'vitest';

import { LEXICON_TAG, canBankTopic } from '../bank-topic';

describe('canBankTopic (T69, T75)', () => {
  it('the A1 lexicon (category torfl, tagged torfl:lexicon) banks', () => {
    expect(canBankTopic({ category: 'torfl', tags: [LEXICON_TAG] })).toBe(true);
  });

  it('the A2 lexicon (category torfl-a2, tagged torfl:lexicon) banks too (T75, CT037)', () => {
    expect(canBankTopic({ category: 'torfl-a2', tags: [LEXICON_TAG] })).toBe(true);
  });

  it('a TORFL shelf pack without the lexicon tag does not bank', () => {
    expect(canBankTopic({ category: 'torfl', tags: [] })).toBe(false);
    expect(canBankTopic({ category: 'torfl-a2', tags: ['torfl:exam'] })).toBe(false);
  });

  it('a creepypasta tagged torfl:lexicon (not a TORFL shelf) does not bank', () => {
    expect(canBankTopic({ category: 'stories', tags: [LEXICON_TAG] })).toBe(false);
  });

  it('a pack with no category does not bank', () => {
    expect(canBankTopic({ category: null, tags: [LEXICON_TAG] })).toBe(false);
  });
});
