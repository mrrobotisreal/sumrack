import { describe, expect, it } from 'vitest';

import { formatTime } from '../format-time';
import { LISTEN_RATES, sanitizeListenPrefs } from '../prefs';
import {
  EMPTY_PROGRESS,
  PROGRESS_CAP,
  clearFinished,
  markFinished,
  markProgress,
  percentFor,
  resumePositionFor,
  sanitizeProgress,
} from '../progress';

describe('prefs', () => {
  it('has exactly the eight notches, none above 2', () => {
    expect([...LISTEN_RATES]).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
  it('heals per field', () => {
    expect(sanitizeListenPrefs(null)).toEqual({ v: 1, rate: 1, volume: 1, muted: false });
    expect(sanitizeListenPrefs({ rate: 3, volume: 0.4, muted: 'x' })).toEqual({
      v: 1,
      rate: 1,
      volume: 0.4,
      muted: false,
    });
    expect(sanitizeListenPrefs({ rate: 0.25, volume: 2, muted: true })).toMatchObject({
      rate: 0.25,
      volume: 1,
      muted: true,
    });
  });
});

describe('progress', () => {
  it('resumes only past 5 s and when not finished', () => {
    let p = markProgress(EMPTY_PROGRESS, 'a', 4000, 100000, 1);
    expect(resumePositionFor(p, 'a')).toBe(0);
    p = markProgress(p, 'a', 5001, 100000, 2);
    expect(resumePositionFor(p, 'a')).toBe(5001);
    p = markFinished(p, 'a', 100000, 3);
    expect(resumePositionFor(p, 'a')).toBe(0);
    expect(percentFor(p, 'a')).toBe(100);
    expect(percentFor(clearFinished(p, 'a'), 'a')).toBe(0);
    expect(resumePositionFor(EMPTY_PROGRESS, 'zzz')).toBe(0);
  });
  it('percentFor rounds and clamps', () => {
    const p = markProgress(EMPTY_PROGRESS, 'a', 25000, 100000, 1);
    expect(percentFor(p, 'a')).toBe(25);
  });
  it('sanitize heals garbage and caps oldest-dropped', () => {
    expect(sanitizeProgress('x')).toEqual(EMPTY_PROGRESS);
    expect(sanitizeProgress({ byPack: { a: { positionMs: 'no' } } }).byPack).toEqual({});
    const byPack: Record<string, unknown> = {};
    for (let i = 0; i < PROGRESS_CAP + 5; i++) {
      byPack[`p${i}`] = { positionMs: 1, durationMs: 2, updatedAt: i };
    }
    const out = sanitizeProgress({ v: 1, byPack });
    expect(Object.keys(out.byPack)).toHaveLength(PROGRESS_CAP);
    expect(out.byPack.p0).toBeUndefined();
    expect(out.byPack[`p${PROGRESS_CAP + 4}`]).toBeDefined();
  });
});

describe('formatTime', () => {
  it('formats', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(192000)).toBe('3:12');
    expect(formatTime(3725000)).toBe('1:02:05');
    expect(formatTime(-5)).toBe('0:00');
  });
});
