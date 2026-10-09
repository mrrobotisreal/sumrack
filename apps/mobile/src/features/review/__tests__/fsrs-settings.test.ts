import { describe, expect, it } from 'vitest';

import {
  DEFAULT_W,
  parseOptimizerFile,
  parseRetention,
  parseStoredParams,
  RETENTION_DEFAULT,
} from '../fsrs-settings';

/** T39: pure FSRS settings — retention heal, optimizer file parse, stored params heal. */

const validFile = () => ({
  v: 1,
  kind: 'sumrak-fsrs-params',
  w: [...DEFAULT_W],
  fittedAt: '2026-10-09T10:00:00Z',
  reviewCount: 1234,
  cardCount: 321,
  logLoss: 0.31,
  rmse: 0.04,
  defaultLogLoss: 0.35,
  defaultRmse: 0.06,
});

describe('parseRetention', () => {
  it('keeps valid values, rounded to 2 decimals', () => {
    expect(parseRetention(0.85)).toBe(0.85);
    expect(parseRetention(0.8)).toBe(0.8);
    expect(parseRetention(0.95)).toBe(0.95);
    expect(parseRetention(0.8749)).toBe(0.87);
  });

  it('heals anything out of band or non-numeric to 0.9', () => {
    for (const bad of [0.79, 0.96, 0, 1, -1, NaN, Infinity, '0.9', null, undefined, {}]) {
      expect(parseRetention(bad)).toBe(RETENTION_DEFAULT);
    }
  });
});

describe('parseOptimizerFile', () => {
  it('accepts a valid file', () => {
    const r = parseOptimizerFile(JSON.stringify(validFile()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.w).toHaveLength(21);
      expect(r.value.reviewCount).toBe(1234);
    }
  });

  it('accepts a minimal file (optional fields absent) and unknown extra keys', () => {
    const { logLoss: _a, rmse: _b, defaultLogLoss: _c, defaultRmse: _d, ...min } = validFile();
    expect(
      parseOptimizerFile(JSON.stringify({ ...min, extra: 'ok', warning: 'few reviews' })).ok,
    ).toBe(true);
  });

  it('rejects a weight vector of length 20', () => {
    const f = validFile();
    f.w = f.w.slice(0, 20);
    const r = parseOptimizerFile(JSON.stringify(f));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/21 weights/);
  });

  it('rejects a NaN weight (JSON cannot carry NaN, so it arrives as null)', () => {
    const f = validFile() as unknown as { w: unknown[] };
    f.w[3] = null;
    const r = parseOptimizerFile(JSON.stringify(f));
    expect(r.ok).toBe(false);
  });

  it('rejects an out-of-bounds weight with a readable reason', () => {
    const f = validFile();
    f.w[7] = 7;
    const r = parseOptimizerFile(JSON.stringify(f));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/weight 7 is 7, outside 0\.001–0\.75/);
  });

  it('rejects a wrong kind', () => {
    expect(parseOptimizerFile(JSON.stringify({ ...validFile(), kind: 'other' })).ok).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(parseOptimizerFile(JSON.stringify({ ...validFile(), v: 2 })).ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const r = parseOptimizerFile('{not json');
    expect(r).toEqual({ ok: false, reason: 'not valid JSON' });
  });

  it('rejects reviewCount < 1', () => {
    const r = parseOptimizerFile(JSON.stringify({ ...validFile(), reviewCount: 0 }));
    expect(r.ok).toBe(false);
  });
});

describe('parseStoredParams', () => {
  const stored = () => ({
    v: 1,
    w: [...DEFAULT_W],
    fittedAt: '2026-10-09T10:00:00Z',
    importedAt: 1700000000000,
    reviewCount: 1234,
    cardCount: 321,
  });

  it('accepts a valid stored row', () => {
    expect(parseStoredParams(stored())).toMatchObject({ v: 1, reviewCount: 1234 });
  });

  it('heals anything malformed to null', () => {
    expect(parseStoredParams(null)).toBeNull();
    expect(parseStoredParams('nope')).toBeNull();
    expect(parseStoredParams({ ...stored(), v: 2 })).toBeNull();
    expect(parseStoredParams({ ...stored(), w: [1, 2, 3] })).toBeNull();
    expect(parseStoredParams({ ...stored(), w: [...DEFAULT_W.slice(0, 20), 99] })).toBeNull();
  });
});
