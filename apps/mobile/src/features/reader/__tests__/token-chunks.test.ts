import { describe, expect, it } from 'vitest';

import type { TokenRow } from '@/db/repositories/content';

import {
  buildChunks,
  glossTranslation,
  normalizeRange,
  phraseSurface,
  snapRangeToWords,
  wordTokensInRange,
} from '../token-chunks';

/** Minimal TokenRow factory — only the fields chunking reads matter. */
function tok(
  text: string,
  opts: Partial<Pick<TokenRow, 'isPunct' | 'spaceBefore' | 'lemma' | 'translation'>> = {},
): TokenRow {
  return {
    packId: 'p',
    sentenceId: 's',
    tokenIndex: 0,
    storyId: 'st',
    text,
    textNorm: text.toLowerCase(),
    isPunct: opts.isPunct ?? false,
    // Importer stores the *effective* spaceBefore: words default true, punct false.
    spaceBefore: opts.spaceBefore ?? !opts.isPunct,
    lemma: opts.lemma ?? (opts.isPunct ? null : text.toLowerCase()),
    lemmaNorm: null,
    translation: opts.translation ?? (opts.isPunct ? null : `<${text}>`),
    pos: null,
    grammar: null,
    level: null,
    note: null,
  };
}

/** «Я думаю: «Это соседи».» — the fixture sentence with quote overrides. */
function quotedSentence(): TokenRow[] {
  const tokens = [
    tok('Я', { translation: 'I' }),
    tok('думаю', { translation: 'think' }),
    tok(':', { isPunct: true }),
    tok('«', { isPunct: true, spaceBefore: true }),
    tok('Это', { spaceBefore: false, translation: 'it (is)' }),
    tok('соседи', { translation: 'the neighbours' }),
    tok('»', { isPunct: true }),
    tok('.', { isPunct: true }),
  ];
  // First token never has a visible leading space.
  tokens[0]!.spaceBefore = false;
  return tokens;
}

describe('buildChunks', () => {
  it('groups punctuation with its word so nothing wraps apart', () => {
    const chunks = buildChunks(quotedSentence());
    expect(chunks.map((c) => c.text)).toEqual(['Я', 'думаю:', '«Это', 'соседи».']);
  });

  it('reconstructs the sentence exactly when joined with single spaces', () => {
    const chunks = buildChunks(quotedSentence());
    expect(chunks.map((c) => c.text).join(' ')).toBe('Я думаю: «Это соседи».');
  });

  it('exposes the word token of each chunk; punctuation-only chunks have none', () => {
    const chunks = buildChunks([
      tok('Тихо', { spaceBefore: false }),
      tok('—', { isPunct: true, spaceBefore: true }),
      tok('очень', { spaceBefore: true }),
    ]);
    expect(chunks.map((c) => c.wordToken?.text ?? null)).toEqual(['Тихо', null, 'очень']);
  });

  it('handles a simple sentence with trailing period', () => {
    const tokens = [tok('Я'), tok('живу'), tok('один'), tok('.', { isPunct: true })];
    tokens[0]!.spaceBefore = false;
    const chunks = buildChunks(tokens);
    expect(chunks.map((c) => c.text)).toEqual(['Я', 'живу', 'один.']);
    expect(chunks[2]!.wordToken?.text).toBe('один');
  });
});

describe('selection ranges', () => {
  const chunks = buildChunks(quotedSentence());

  it('normalizeRange orders endpoints regardless of drag direction', () => {
    expect(normalizeRange(3, 1)).toEqual({ start: 1, end: 3 });
    expect(normalizeRange(1, 3)).toEqual({ start: 1, end: 3 });
  });

  it('snapRangeToWords keeps word-bearing chunks as endpoints', () => {
    // All four chunks contain word tokens here — snap is identity.
    expect(snapRangeToWords(chunks, { start: 0, end: 3 })).toEqual({ start: 0, end: 3 });
  });

  it('snapRangeToWords trims punctuation-only endpoint chunks', () => {
    const withDash = buildChunks([
      tok('Тихо', { spaceBefore: false }),
      tok('—', { isPunct: true, spaceBefore: true }),
      tok('очень', { spaceBefore: true }),
    ]);
    expect(snapRangeToWords(withDash, { start: 1, end: 2 })).toEqual({ start: 2, end: 2 });
    expect(snapRangeToWords(withDash, { start: 1, end: 1 })).toBeNull();
  });

  it('phraseSurface is an exact substring of the sentence', () => {
    expect(phraseSurface(chunks, { start: 2, end: 3 })).toBe('«Это соседи».');
    expect('Я думаю: «Это соседи».').toContain(phraseSurface(chunks, { start: 1, end: 2 }));
  });

  it('full-sentence selection reproduces the whole sentence', () => {
    expect(phraseSurface(chunks, { start: 0, end: chunks.length - 1 })).toBe(
      'Я думаю: «Это соседи».',
    );
  });

  it('glossTranslation joins word glosses only, skipping punctuation', () => {
    expect(glossTranslation(chunks, { start: 0, end: 3 })).toBe('I think it (is) the neighbours');
  });

  it('wordTokensInRange excludes punctuation tokens', () => {
    const words = wordTokensInRange(chunks, { start: 2, end: 3 });
    expect(words.map((w) => w.text)).toEqual(['Это', 'соседи']);
  });
});
