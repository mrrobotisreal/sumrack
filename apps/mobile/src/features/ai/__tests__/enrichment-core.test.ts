import { describe, expect, it } from 'vitest';

import { parseEnrichmentCompletion, sanitizeProposal, windowAround } from '../enrichment-core';

const WORD = { id: 'w1', kind: 'word' as const, lemma: 'словами', surface: 'словами' };
const PHRASE = { id: 'p1', kind: 'phrase' as const, lemma: null, surface: 'по крайней мере' };

describe('sanitizeProposal', () => {
  it('strips lemma and pos from phrase proposals', () => {
    const clean = sanitizeProposal(PHRASE, {
      id: 'p1',
      lemma: 'мера',
      pos: 'noun',
      translation: 'at least',
      level: 'A2',
    });
    expect(clean).toEqual({ id: 'p1', translation: 'at least', level: 'A2' });
  });

  it('falls back to the current provisional lemma for words', () => {
    const clean = sanitizeProposal(WORD, { id: 'w1', translation: 'words' });
    expect(clean.lemma).toBe('словами');
  });
});

describe('parseEnrichmentCompletion', () => {
  it('joins proposals to requested items and drops unknown ids', () => {
    const content = JSON.stringify({
      items: [
        { id: 'w1', lemma: 'слово', translation: 'word', pos: 'noun', level: 'A1' },
        { id: 'hallucinated', translation: 'ghost' },
      ],
    });
    const map = parseEnrichmentCompletion(content, [WORD, PHRASE]);
    expect([...map.keys()]).toEqual(['w1']);
    expect(map.get('w1')).toMatchObject({ lemma: 'слово', translation: 'word' });
  });

  it('keeps the first proposal when the model duplicates an id', () => {
    const content = JSON.stringify({
      items: [
        { id: 'w1', translation: 'first' },
        { id: 'w1', translation: 'second' },
      ],
    });
    expect(parseEnrichmentCompletion(content, [WORD]).get('w1')!.translation).toBe('first');
  });

  it('throws invalid-response on a malformed completion', () => {
    expect(() => parseEnrichmentCompletion('no json', [WORD])).toThrowError(/expected shape/);
    expect(() =>
      parseEnrichmentCompletion(JSON.stringify({ items: [{ id: 'w1' }] }), [WORD]),
    ).toThrowError(/expected shape/);
  });
});

describe('windowAround', () => {
  it('returns a trimmed window around the needle', () => {
    const text = `${'а'.repeat(200)} наверху ${'б'.repeat(200)}`;
    const win = windowAround(text, 'наверху')!;
    expect(win).toContain('наверху');
    expect(win.length).toBeLessThanOrEqual(90 * 2 + 'наверху'.length + 2);
  });

  it('is case-insensitive and falls back to the text head when absent', () => {
    expect(windowAround('Наверху кто-то ходит.', 'наверху')).toBe('Наверху кто-то ходит.');
    expect(windowAround('совсем другой текст', 'наверху')).toBe('совсем другой текст');
  });
});
