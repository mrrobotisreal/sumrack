import { describe, expect, it } from 'vitest';

import {
  buildImportedPackId,
  IMPORT_CHAR_CAP,
  normalizeIntakeText,
  planImportSplit,
  slugify,
  splitSentences,
  suggestTitle,
} from '../import-core';

describe('normalizeIntakeText', () => {
  it('NFC-normalizes decomposed input and preserves ё', () => {
    // 'ё' as е + combining diaeresis (decomposed — what chat apps produce)
    const decomposed = 'Ещё оди́н тё̈мный вечер';
    const out = normalizeIntakeText('Ещё один тё̈мный вечер');
    expect(out).toBe(out.normalize('NFC'));
    expect(out).toContain('ё');
    expect(normalizeIntakeText(decomposed)).toBe(decomposed.normalize('NFC'));
  });

  it('strips BOM/zero-width chars and unifies newlines', () => {
    expect(normalizeIntakeText('﻿Привет​, мир\r\nВторая')).toBe('Привет, мир\nВторая');
  });
});

describe('splitSentences', () => {
  it('splits on terminal punctuation keeping closers attached', () => {
    expect(splitSentences('Привет. Как дела? «Хорошо!» Ладно…')).toEqual([
      'Привет.',
      'Как дела?',
      '«Хорошо!»',
      'Ладно…',
    ]);
  });

  it('treats paragraphs as boundaries and collapses inner whitespace', () => {
    expect(splitSentences('Первая строка без точки\nВторая  строка')).toEqual([
      'Первая строка без точки',
      'Вторая строка',
    ]);
  });

  // T29: abbreviation awareness (heuristic — review's merge/split is the escape hatch)
  it('does not split after leading abbreviations or single-letter initials', () => {
    expect(splitSentences('Мы живём на ул. Ленина. Там тихо.')).toEqual([
      'Мы живём на ул. Ленина.',
      'Там тихо.',
    ]);
    expect(splitSentences('А. С. Пушкин родился в Москве. Потом он уехал.')).toEqual([
      'А. С. Пушкин родился в Москве.',
      'Потом он уехал.',
    ]);
    expect(splitSentences('См. страницу пять. Дальше интереснее.')).toEqual([
      'См. страницу пять.',
      'Дальше интереснее.',
    ]);
  });

  it('keeps «т. д.»-style compounds whole but lets them end sentences', () => {
    expect(splitSentences('Мы купили хлеб, молоко и т. д. Потом пошли домой.')).toEqual([
      'Мы купили хлеб, молоко и т. д.',
      'Потом пошли домой.',
    ]);
    expect(splitSentences('Сыр, т. е. очень хороший сыр, кончился.')).toEqual([
      'Сыр, т. е. очень хороший сыр, кончился.',
    ]);
  });

  it('splits after can-end-a-sentence abbreviations only before a capitalized start', () => {
    expect(splitSentences('Это было в 1999 г. в старом доме.')).toEqual([
      'Это было в 1999 г. в старом доме.',
    ]);
    expect(splitSentences('Это было в 1999 г. Мы переехали.')).toEqual([
      'Это было в 1999 г.',
      'Мы переехали.',
    ]);
  });
});

describe('suggestTitle', () => {
  it('takes opening words up to ~40 chars and trims punctuation', () => {
    expect(suggestTitle('Привет, как дела? Я сегодня видел кота.')).toBe('Привет, как дела');
    expect(suggestTitle('Слово')).toBe('Слово');
  });
});

describe('slugify / buildImportedPackId', () => {
  it('transliterates Russian titles into StableId-safe slugs', () => {
    expect(slugify('Ночные гости')).toBe('nochnye-gosti');
    expect(slugify('Ещё борщ!')).toBe('esche-borsch');
    expect(slugify('***')).toBe('tekst');
  });

  it('dedups same-day collisions deterministically (-2, -3)', () => {
    const now = new Date('2026-08-25T12:00:00');
    const first = buildImportedPackId('Письмо', [], now);
    expect(first).toBe('imported-20260825-pismo');
    expect(buildImportedPackId('Письмо', [first], now)).toBe('imported-20260825-pismo-2');
    expect(buildImportedPackId('Письмо', [first, `${first}-2`], now)).toBe(
      'imported-20260825-pismo-3',
    );
  });
});

describe('planImportSplit', () => {
  it('returns under-cap text untouched', () => {
    expect(planImportSplit('Привет.')).toEqual(['Привет.']);
  });

  it('splits over-cap input at sentence boundaries, every part within cap', () => {
    const sentence = 'Это очень тёмная и длинная история про старый дом у леса.';
    const text = Array(120).fill(sentence).join(' ');
    expect(text.length).toBeGreaterThan(IMPORT_CHAR_CAP);
    const parts = planImportSplit(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(IMPORT_CHAR_CAP);
      // parts start/end on sentence boundaries
      expect(part.startsWith('Это')).toBe(true);
      expect(part.endsWith('.')).toBe(true);
    }
    // nothing lost: parts re-join to the sentence-collapsed text
    expect(parts.join(' ')).toBe(splitSentences(text).join(' '));
  });

  it('hard-splits a single pathological over-cap sentence at whitespace', () => {
    const text = Array(1500).fill('слово').join(' '); // one 'sentence', no terminals
    const parts = planImportSplit(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(IMPORT_CHAR_CAP);
  });
});
