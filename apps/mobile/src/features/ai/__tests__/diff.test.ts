import { describe, expect, it } from 'vitest';

import { diffWords, isUnchanged } from '../diff';

describe('diffWords', () => {
  it('marks an unchanged text as all-same', () => {
    const segments = diffWords('Я люблю читать.', 'Я люблю читать.');
    expect(segments).toEqual([{ type: 'same', text: 'Я люблю читать.' }]);
    expect(isUnchanged(segments!)).toBe(true);
  });

  it('diffs a single word substitution', () => {
    const segments = diffWords('Я идти домой.', 'Я иду домой.');
    expect(segments).toEqual([
      { type: 'same', text: 'Я' },
      { type: 'del', text: 'идти' },
      { type: 'ins', text: 'иду' },
      { type: 'same', text: 'домой.' },
    ]);
    expect(isUnchanged(segments!)).toBe(false);
  });

  it('handles multi-word replacement runs', () => {
    const segments = diffWords('с моя невеста', 'с моей невестой');
    expect(segments).toEqual([
      { type: 'same', text: 'с' },
      { type: 'del', text: 'моя невеста' },
      { type: 'ins', text: 'моей невестой' },
    ]);
  });

  it('handles pure insertion and deletion at the ends', () => {
    expect(diffWords('я читаю', 'вчера я читаю')).toEqual([
      { type: 'ins', text: 'вчера' },
      { type: 'same', text: 'я читаю' },
    ]);
    expect(diffWords('я читаю книгу', 'я читаю')).toEqual([
      { type: 'same', text: 'я читаю' },
      { type: 'del', text: 'книгу' },
    ]);
  });

  it('treats case and ё changes as real corrections', () => {
    const segments = diffWords('темный дом', 'тёмный дом');
    expect(segments![0]).toEqual({ type: 'del', text: 'темный' });
    expect(segments![1]).toEqual({ type: 'ins', text: 'тёмный' });
  });

  it('normalizes NFD input so equivalent words compare equal', () => {
    // 'й' composed vs decomposed
    const nfd = 'мой дом'.normalize('NFD');
    expect(diffWords(nfd, 'мой дом')).toEqual([{ type: 'same', text: 'мой дом' }]);
  });

  it('collapses whitespace differences silently', () => {
    expect(diffWords('я  читаю\nкнигу', 'я читаю книгу')).toEqual([
      { type: 'same', text: 'я читаю книгу' },
    ]);
  });

  it('returns null past the size cap instead of freezing', () => {
    const big = Array.from({ length: 700 }, (_, i) => `слово${i}`).join(' ');
    expect(diffWords(big, big)).toBeNull();
  });

  it('handles empty originals', () => {
    expect(diffWords('', 'привет')).toEqual([{ type: 'ins', text: 'привет' }]);
    expect(diffWords('', '')).toEqual([]);
  });
});
