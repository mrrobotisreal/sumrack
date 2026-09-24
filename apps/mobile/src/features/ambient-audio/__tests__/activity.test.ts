import { describe, expect, it, vi } from 'vitest';

import { effectiveTheme } from '../activity';
import type { AmbientThemeId } from '../beds';

vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('../sources', () => ({ AMBIENT_BED_SOURCES: {} }));

function map(...entries: (AmbientThemeId | undefined)[]) {
  return new Map(entries.map((theme, i) => [Symbol(String(i)), theme] as const));
}

describe('effectiveTheme', () => {
  it('defaults to horror with no activities', () => {
    expect(effectiveTheme(map())).toBe('horror');
  });

  it('takes the most recently registered activity', () => {
    expect(effectiveTheme(map('news'))).toBe('news');
    expect(effectiveTheme(map('news', 'comedy'))).toBe('comedy');
  });

  it('a later registration without a theme means the default (game over a news article)', () => {
    expect(effectiveTheme(map('news', undefined))).toBe('horror');
  });

  it('an earlier undefined does not hide a later theme', () => {
    expect(effectiveTheme(map(undefined, 'education'))).toBe('education');
  });

  it('re-registration order wins, not symbol creation order', () => {
    const reader = Symbol('reader');
    const game = Symbol('game');
    const m = new Map<symbol, AmbientThemeId | undefined>([
      [game, undefined],
      [reader, 'news'],
    ]);
    expect(effectiveTheme(m)).toBe('news');
    m.delete(reader);
    m.set(reader, 'news');
    expect(effectiveTheme(m)).toBe('news');
    m.delete(game);
    m.set(game, undefined);
    expect(effectiveTheme(m)).toBe('horror');
  });
});
