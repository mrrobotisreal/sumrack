import { describe, expect, it } from 'vitest';

import { formatRuDate, formatRuDateFallback } from '@/features/library/library-filter';
import * as ruDate from '@/lib/ru-date';

// The full behaviour suite lives in features/library/__tests__/library-filter.test.ts
// (T45); this pins the T46 relocation — one implementation, two import paths.
describe('lib/ru-date (T46 relocation)', () => {
  it('library-filter re-exports the very same functions', () => {
    expect(formatRuDate).toBe(ruDate.formatRuDate);
    expect(formatRuDateFallback).toBe(ruDate.formatRuDateFallback);
  });

  it('renders the §4.3 caption date', () => {
    expect(ruDate.formatRuDate('2026-09-14')).toBe('14 сент. 2026');
  });
});
