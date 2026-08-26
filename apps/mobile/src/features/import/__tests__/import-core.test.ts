import { parsePack, reconstructSentenceRu, type Pack } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  buildImportedPackId,
  buildStubPack,
  IMPORT_CHAR_CAP,
  normalizeIntakeText,
  planImportSplit,
  slugify,
  splitSentences,
  suggestTitle,
  tokenizeSentence,
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

describe('tokenizeSentence', () => {
  it('splits words and punctuation so reconstruction is exact', () => {
    const ru = '«Привет, — сказал он. — Кто-то ждёт?»';
    const tokens = tokenizeSentence(ru);
    expect(reconstructSentenceRu(tokens)).toBe(ru);
    // hyphenated word stays one token; quotes/dashes are punct
    expect(tokens.find((t) => t.text === 'Кто-то')?.isPunct).toBeUndefined();
    expect(tokens.find((t) => t.text === '«')?.isPunct).toBe(true);
    expect(tokens.filter((t) => !t.isPunct).every((t) => t.lemma === t.text)).toBe(true);
  });

  it('handles standalone punctuation chunks', () => {
    const ru = 'Ночь — это время.';
    expect(reconstructSentenceRu(tokenizeSentence(ru))).toBe(ru);
  });
});

describe('buildStubPack', () => {
  it('builds a pack that passes the real schema commit gate', () => {
    const raw = buildStubPack({
      packId: 'imported-20260825-test',
      title: 'Тёмный вечер',
      text: 'Это тёмный вечер. Кто-то стучит в дверь!\n«Открой», — говорит голос…',
    });
    const pack: Pack = parsePack(raw); // throws on any schema violation
    expect(pack.id).toBe('imported-20260825-test');
    expect(pack.type).toBe('stories');
    expect(pack.tags).toContain('imported');
    expect(pack.stories[0]!.sentences).toHaveLength(3);
    expect(pack.stories[0]!.audio).toEqual([]);
    // ё preserved through the whole path
    expect(pack.stories[0]!.sentences[0]!.ru).toContain('тёмный');
    // sentence ids story-namespaced + unique
    expect(pack.stories[0]!.sentences.map((s) => s.id)).toEqual(['s1-001', 's1-002', 's1-003']);
  });

  it('survives messy decomposed multi-paragraph input end-to-end', () => {
    const text = normalizeIntakeText('Ещё оди́н ве́чер̈.\n\n  Двойные   пробелы?  Да.');
    const raw = buildStubPack({ packId: 'imported-20260825-messy', title: 'Тест', text });
    expect(() => parsePack(raw)).not.toThrow();
  });
});
