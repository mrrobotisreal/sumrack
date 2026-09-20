import { describe, expect, it } from 'vitest';

import { formatSourceLine } from '../source-line';

describe('formatSourceLine (M14 §5 reader-header source line, T46)', () => {
  it('news-090-a2 fixture: name · date (no author)', () => {
    expect(
      formatSourceLine({
        name: 'Сумрак-тест',
        url: 'https://example.invalid/first-snow',
        publishedAt: '2026-09-14',
        author: null,
      }),
    ).toBe('Сумрак-тест · 14 сент. 2026');
  });

  it('news-090-a1 fixture: name · date · author (no url — pressability is the header’s call)', () => {
    expect(
      formatSourceLine({
        name: 'Сумрак-тест',
        url: null,
        publishedAt: '2026-09-10',
        author: 'Редакция',
      }),
    ).toBe('Сумрак-тест · 10 сент. 2026 · Редакция');
  });

  it('podcast fixture: all four parts present', () => {
    expect(
      formatSourceLine({
        name: 'Сумрак',
        url: null,
        publishedAt: '2026-09-01',
        author: 'Мистер Уинтроу',
      }),
    ).toBe('Сумрак · 1 сент. 2026 · Мистер Уинтроу');
  });

  it('name alone when nothing else is authored; author without a date keeps the order', () => {
    expect(
      formatSourceLine({ name: 'Mitchell Wintrow', url: null, publishedAt: null, author: null }),
    ).toBe('Mitchell Wintrow');
    expect(
      formatSourceLine({ name: 'Медуза', url: null, publishedAt: null, author: 'Иван Иванов' }),
    ).toBe('Медуза · Иван Иванов');
  });
});
