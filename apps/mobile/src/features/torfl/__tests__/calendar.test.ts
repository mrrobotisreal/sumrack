import { describe, expect, it } from 'vitest';

import { monthGrid, monthTitle, shiftMonth } from '../calendar';

describe('exam-date calendar', () => {
  it('shiftMonth crosses years both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('monthTitle', () => {
    expect(monthTitle('2026-10')).toBe('Октябрь 2026');
  });

  it('monthGrid is Monday-first and padded to whole weeks', () => {
    // 1 Oct 2026 is a Thursday → three leading blanks.
    const oct = monthGrid('2026-10');
    expect(oct.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(oct.filter(Boolean)).toHaveLength(31);
    expect(oct.length % 7).toBe(0);
    // 1 Feb 2027 is a Monday → no padding; 28 days.
    const feb = monthGrid('2027-02');
    expect(feb[0]).toBe('2027-02-01');
    expect(feb.filter(Boolean)).toHaveLength(28);
  });
});
