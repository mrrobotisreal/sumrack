import { describe, expect, it } from 'vitest';

import { resolveRestoreTarget } from '../restore';

describe('resolveRestoreTarget (T30.2)', () => {
  it('both plain entry paths restore an unfinished saved position identically', () => {
    // Library card and Today continue card both open without a deep link —
    // the input is identical, so the contract is too.
    const libraryOpen = resolveRestoreTarget({
      savedIdx: 5,
      finished: false,
      sentenceCount: 38,
    });
    const todayOpen = resolveRestoreTarget({
      initialSentenceIdx: undefined,
      savedIdx: 5,
      finished: false,
      sentenceCount: 38,
    });
    expect(libraryOpen).toEqual({ targetIdx: 5, source: 'saved' });
    expect(todayOpen).toEqual(libraryOpen);
  });

  it('fresh stories (no row, or saved 0) open at the top', () => {
    expect(resolveRestoreTarget({ savedIdx: null, finished: false, sentenceCount: 38 })).toEqual({
      targetIdx: null,
      source: 'top',
    });
    expect(resolveRestoreTarget({ savedIdx: 0, finished: false, sentenceCount: 38 })).toEqual({
      targetIdx: null,
      source: 'top',
    });
  });

  it('finished stories open at the top even with a saved index', () => {
    expect(resolveRestoreTarget({ savedIdx: 20, finished: true, sentenceCount: 38 })).toEqual({
      targetIdx: null,
      source: 'top',
    });
  });

  it('an out-of-range saved index (pack shrank) opens at the top', () => {
    expect(resolveRestoreTarget({ savedIdx: 38, finished: false, sentenceCount: 38 })).toEqual({
      targetIdx: null,
      source: 'top',
    });
  });

  it('a deep link wins over the saved position, including a link to the top', () => {
    expect(
      resolveRestoreTarget({
        initialSentenceIdx: 12,
        savedIdx: 5,
        finished: false,
        sentenceCount: 38,
      }),
    ).toEqual({ targetIdx: 12, source: 'deep-link' });
    // Linking to sentence 0 is still a deep link — no restore of saved 5.
    expect(
      resolveRestoreTarget({
        initialSentenceIdx: 0,
        savedIdx: 5,
        finished: false,
        sentenceCount: 38,
      }),
    ).toEqual({ targetIdx: null, source: 'deep-link' });
  });

  it('deep links work on finished stories (bookmarks into a finished part)', () => {
    expect(
      resolveRestoreTarget({
        initialSentenceIdx: 9,
        savedIdx: 30,
        finished: true,
        sentenceCount: 38,
      }),
    ).toEqual({ targetIdx: 9, source: 'deep-link' });
  });

  it('an out-of-range deep link falls back to the top, not the saved position', () => {
    expect(
      resolveRestoreTarget({
        initialSentenceIdx: 99,
        savedIdx: 5,
        finished: false,
        sentenceCount: 38,
      }),
    ).toEqual({ targetIdx: null, source: 'deep-link' });
  });
});
