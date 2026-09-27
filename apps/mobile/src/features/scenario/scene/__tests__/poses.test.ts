import { describe, expect, it } from 'vitest';

import {
  BLINK_GAP_MAX_MS,
  BLINK_GAP_MIN_MS,
  BLINK_GAPS_MS,
  BLINK_MS,
  BREATH_PERIOD_MS,
  NEUTRAL_TARGETS,
  poseTargets,
  SCENE_POSES,
  SPEAKING_GLOW_BOOST,
  TILT_DEGREES,
} from '../poses';

describe('pose recipes (§8.1 item 6)', () => {
  it('reduce-motion freezes every pose on the neutral poster', () => {
    for (const pose of SCENE_POSES) {
      for (const png of [true, false]) {
        expect(poseTargets(pose, { reduceMotion: true, png })).toEqual(NEUTRAL_TARGETS);
      }
    }
    expect(NEUTRAL_TARGETS.breathe).toBe(false);
    expect(NEUTRAL_TARGETS.tilt).toBe(false);
  });

  it('idle breathes only', () => {
    const t = poseTargets('idle', { reduceMotion: false, png: false });
    expect(t).toEqual({ ...NEUTRAL_TARGETS, breathe: true });
  });

  it('speaking tilts and brightens the glow by 10 %', () => {
    const t = poseTargets('speaking', { reduceMotion: false, png: true });
    expect(t.tilt).toBe(true);
    expect(t.glow).toBeCloseTo(1 + SPEAKING_GLOW_BOOST);
    expect(TILT_DEGREES).toBeGreaterThanOrEqual(1);
    expect(TILT_DEGREES).toBeLessThanOrEqual(2);
  });

  it('listening leans 6 px in; the brow lift is placeholder-only', () => {
    expect(poseTargets('listening', { reduceMotion: false, png: false })).toMatchObject({
      leanX: -6,
      browLift: -4,
    });
    expect(poseTargets('listening', { reduceMotion: false, png: true })).toMatchObject({
      leanX: -6,
      browLift: 0,
    });
  });

  it('thinking looks up-left on the placeholder only', () => {
    const svg = poseTargets('thinking', { reduceMotion: false, png: false });
    expect(svg.gazeX).toBeLessThan(0);
    expect(svg.gazeY).toBeLessThan(0);
    const png = poseTargets('thinking', { reduceMotion: false, png: true });
    expect(png.gazeX).toBe(0);
    expect(png.gazeY).toBe(0);
  });

  it('timings match the design numbers', () => {
    expect(BREATH_PERIOD_MS).toBe(3600);
    expect(BLINK_MS).toBe(120);
    for (const gap of BLINK_GAPS_MS) {
      expect(gap).toBeGreaterThanOrEqual(BLINK_GAP_MIN_MS);
      expect(gap).toBeLessThanOrEqual(BLINK_GAP_MAX_MS);
    }
  });
});
