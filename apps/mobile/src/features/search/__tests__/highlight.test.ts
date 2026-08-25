import { describe, expect, it } from 'vitest';

import { highlightSnippet } from '../highlight';

describe('highlightSnippet', () => {
  it('marks exactly the matched surfaces, punctuation-tolerant', () => {
    const segs = highlightSnippet('В стене — стук, снова стук.', ['стук']);
    const marked = segs.filter((s) => s.matched).map((s) => s.text);
    expect(marked).toEqual(['стук,', 'стук.']);
  });

  it('is ё/е-tolerant in both directions', () => {
    expect(highlightSnippet('Чёрный кот.', ['черный']).find((s) => s.matched)?.text).toBe('Чёрный');
    expect(highlightSnippet('Черная стена.', ['чёрная']).find((s) => s.matched)?.text).toBe(
      'Черная',
    );
  });

  it('rebuilds the sentence exactly from its segments', () => {
    const ru = 'Он  стоит   у стены.';
    const segs = highlightSnippet(ru, []);
    expect(segs.map((s) => s.text).join('')).toBe(ru);
  });

  it('never matches on empty cores (pure punctuation chunks)', () => {
    const segs = highlightSnippet('Стук — стук', ['—']);
    expect(segs.some((s) => s.matched)).toBe(false);
  });
});
