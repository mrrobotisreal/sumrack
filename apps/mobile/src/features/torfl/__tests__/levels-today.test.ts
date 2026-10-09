import { describe, expect, it } from 'vitest';

import { anyExamDate, isLevelActive, levelOrder } from '../levels-today';

describe('levelOrder', () => {
  it('no dates → A1 then A2', () => {
    expect(levelOrder({ A1: null, A2: null })).toEqual(['A1', 'A2']);
  });
  it('only A2 dated → A2 first', () => {
    expect(levelOrder({ A1: null, A2: '2026-12-01' })).toEqual(['A2', 'A1']);
  });
  it('only A1 dated → A1 first', () => {
    expect(levelOrder({ A1: '2026-12-01', A2: null })).toEqual(['A1', 'A2']);
  });
  it('both dated, A2 sooner → A2 first', () => {
    expect(levelOrder({ A1: '2027-03-01', A2: '2026-12-01' })).toEqual(['A2', 'A1']);
  });
  it('both dated, A1 sooner → A1 first', () => {
    expect(levelOrder({ A1: '2026-11-01', A2: '2027-02-01' })).toEqual(['A1', 'A2']);
  });
  it('equal dates → A1 then A2', () => {
    expect(levelOrder({ A1: '2026-12-01', A2: '2026-12-01' })).toEqual(['A1', 'A2']);
  });
  it('a past date counts as nearest (overdue first)', () => {
    expect(levelOrder({ A1: '2026-01-01', A2: '2026-12-01' })).toEqual(['A1', 'A2']);
    expect(levelOrder({ A1: '2026-12-01', A2: '2026-01-01' })).toEqual(['A2', 'A1']);
  });
  it('a dated level precedes an undated one regardless of the fixed order', () => {
    expect(levelOrder({ A1: null, A2: '2030-01-01' })).toEqual(['A2', 'A1']);
  });
});

describe('isLevelActive', () => {
  it('is active with a date or with due items, inactive with neither', () => {
    expect(isLevelActive(null, 0)).toBe(false);
    expect(isLevelActive(null, 3)).toBe(true);
    expect(isLevelActive('2026-12-01', 0)).toBe(true);
  });
});

describe('anyExamDate', () => {
  it('is true iff any level has a date', () => {
    expect(anyExamDate({ A1: null, A2: null })).toBe(false);
    expect(anyExamDate({ A1: '2026-12-01', A2: null })).toBe(true);
    expect(anyExamDate({ A1: null, A2: '2026-12-01' })).toBe(true);
  });
});
