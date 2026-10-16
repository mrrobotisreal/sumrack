import { describe, expect, it } from 'vitest';

import { hotelRunXp } from '../runner/hotel-rewards';

describe('hotelRunXp (T90 decision 8)', () => {
  it('pays the unit first pass +10 and nothing after', () => {
    expect(hotelRunXp({ kind: 'unit', passed: true, firstPass: true })).toBe(10);
    expect(hotelRunXp({ kind: 'unit', passed: true, firstPass: false })).toBe(0);
  });

  it('pays a floor and an экстерн pass +30 on the first pass', () => {
    expect(hotelRunXp({ kind: 'floor', passed: true, firstPass: true })).toBe(30);
    expect(hotelRunXp({ kind: 'extern', passed: true, firstPass: true })).toBe(30);
    expect(hotelRunXp({ kind: 'floor', passed: true, firstPass: false })).toBe(0);
  });

  it('pays nothing for a fail', () => {
    expect(hotelRunXp({ kind: 'unit', passed: false, firstPass: true })).toBe(0);
    expect(hotelRunXp({ kind: 'floor', passed: false, firstPass: true })).toBe(0);
  });
});
