import { describe, expect, it, vi } from 'vitest';

import { TABLE_FLEX_MAX_COLS, tableScrollsHorizontally } from '../markdown-view';

// The component imports native modules; only the pure table rule is under test (vi.mock hoists).
vi.mock('@/components/selectable-text', () => ({ SelectableText: () => null }));
vi.mock('@/theme/use-app-theme', () => ({ useAppTheme: () => ({ tokens: {} }) }));
vi.mock('react-native', () => ({ ScrollView: () => null, Text: () => null, View: () => null }));

describe('MarkdownView table layout rule (T54 lesson tables)', () => {
  it('≤ 3 columns stretch (flex), 4+ columns scroll horizontally with fixed widths', () => {
    expect(TABLE_FLEX_MAX_COLS).toBe(3);
    expect(tableScrollsHorizontally(2)).toBe(false);
    expect(tableScrollsHorizontally(3)).toBe(false);
    expect(tableScrollsHorizontally(4)).toBe(true);
    expect(tableScrollsHorizontally(5)).toBe(true);
  });
});
