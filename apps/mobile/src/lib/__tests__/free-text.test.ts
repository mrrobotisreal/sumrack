import { describe, expect, it } from 'vitest';

import {
  chunkRuns,
  chunkText,
  cleanSurface,
  phraseSurface,
  snapFreeRangeToWords,
  wordCountInRange,
} from '../free-text';

describe('chunkText', () => {
  it('splits on whitespace, punctuation glued to its word', () => {
    const chunks = chunkText('Я слышу, как кто-то ходит.');
    expect(chunks.map((c) => c.text)).toEqual(['Я', 'слышу,', 'как', 'кто-то', 'ходит.']);
    expect(chunks.every((c) => c.isWord)).toBe(true);
  });

  it('free-standing punctuation is not a word chunk', () => {
    const chunks = chunkText('ночь — и тишина');
    expect(chunks.map((c) => c.isWord)).toEqual([true, false, true, true]);
  });

  it('newlines and repeated spaces are plain separators', () => {
    expect(chunkText('раз  два\nтри').map((c) => c.text)).toEqual(['раз', 'два', 'три']);
  });

  it('empty and whitespace-only input yields no chunks', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n ')).toEqual([]);
  });
});

describe('chunkRuns (styled input)', () => {
  it('a bold run spanning two words produces two chunks carrying the style', () => {
    const chunks = chunkRuns([{ text: 'это ' }, { text: 'очень важно', bold: true }]);
    expect(chunks.map((c) => c.text)).toEqual(['это', 'очень', 'важно']);
    expect(chunks[1]!.segments).toEqual([
      { text: 'очень', bold: true, italic: undefined, code: undefined },
    ]);
  });

  it('style change mid-word stays one chunk with two segments', () => {
    const chunks = chunkRuns([{ text: 'при' }, { text: 'вет', bold: true }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe('привет');
    expect(chunks[0]!.segments).toHaveLength(2);
  });

  it('runs whose edges touch whitespace split chunks there', () => {
    const chunks = chunkRuns([
      { text: 'слово ' },
      { text: 'жирное', bold: true },
      { text: ' конец' },
    ]);
    expect(chunks.map((c) => c.text)).toEqual(['слово', 'жирное', 'конец']);
  });
});

describe('cleanSurface', () => {
  it('strips edge punctuation, keeps inner hyphens', () => {
    expect(cleanSurface('слышу,')).toBe('слышу');
    expect(cleanSurface('«кто-то»')).toBe('кто-то');
    expect(cleanSurface('ходит.')).toBe('ходит');
  });

  it('returns null when nothing word-like remains', () => {
    expect(cleanSurface('—')).toBeNull();
    expect(cleanSurface('...')).toBeNull();
  });
});

describe('selection helpers', () => {
  const chunks = chunkText('ночь — и «странная» тишина.');

  it('snap moves endpoints off punctuation-only chunks', () => {
    // range covering the dash only → null
    expect(snapFreeRangeToWords(chunks, { start: 1, end: 1 })).toBeNull();
    // range starting on the dash snaps to «и»
    expect(snapFreeRangeToWords(chunks, { start: 1, end: 3 })).toEqual({ start: 2, end: 3 });
  });

  it('phraseSurface joins chunks and cleans the edges', () => {
    expect(phraseSurface(chunks, { start: 3, end: 4 })).toBe('странная» тишина');
    expect(phraseSurface(chunks, { start: 0, end: 0 })).toBe('ночь');
  });

  it('wordCountInRange counts only word chunks', () => {
    expect(wordCountInRange(chunks, { start: 0, end: 4 })).toBe(4);
    expect(wordCountInRange(chunks, { start: 1, end: 1 })).toBe(0);
  });
});
