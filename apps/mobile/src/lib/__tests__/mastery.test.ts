import { describe, expect, it } from 'vitest';

import { bandForStability, STABILITY_MATURE_MIN, STABILITY_YOUNG_MIN } from '../mastery';

/** T24: the extracted T18 band definition — thresholds must never drift. */
describe('mastery bands (T18 definition)', () => {
  it('pins the T18 thresholds', () => {
    expect(STABILITY_YOUNG_MIN).toBe(7);
    expect(STABILITY_MATURE_MIN).toBe(30);
  });

  it('null/undefined = collected, no band', () => {
    expect(bandForStability(null)).toBeNull();
    expect(bandForStability(undefined)).toBeNull();
  });

  it('bands with exact boundary semantics (< 7, 7–30, ≥ 30)', () => {
    expect(bandForStability(0)).toBe('learning');
    expect(bandForStability(6.999)).toBe('learning');
    expect(bandForStability(7)).toBe('young');
    expect(bandForStability(29.999)).toBe('young');
    expect(bandForStability(30)).toBe('mature');
    expect(bandForStability(365)).toBe('mature');
  });
});
