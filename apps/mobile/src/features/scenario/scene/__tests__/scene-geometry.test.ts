import { describe, expect, it } from 'vitest';

import {
  anchorFromRect,
  BODY_ASPECT,
  characterRect,
  clampAnchor,
  containRect,
  deskRect,
  LAYOUT_HEIGHT,
  mouthRect,
  PLACEHOLDER_MOUTH_ANCHOR,
} from '../scene-geometry';

const box = { w: 600, h: 800 };

describe('characterRect (§8.1 layout presets)', () => {
  it('center = bottom-centre at 78 % height, body aspect', () => {
    const r = characterRect('center', box);
    expect(r.h).toBe(Math.round(800 * 0.78));
    expect(r.w).toBe(Math.round(r.h * BODY_ASPECT));
    expect(r.y + r.h).toBe(800);
    expect(r.x + r.w / 2).toBeCloseTo(300, 0);
  });

  it('left = bottom-left at 70 %', () => {
    const r = characterRect('left', box);
    expect(r.h).toBe(Math.round(800 * 0.7));
    expect(r.x).toBe(0);
    expect(r.y + r.h).toBe(800);
  });

  it('desk = bottom-centre at 62 % sitting behind the desk strip', () => {
    const r = characterRect('desk', box);
    const desk = deskRect(box);
    expect(r.h).toBe(Math.round(800 * 0.62));
    expect(r.y + r.h).toBeLessThan(800);
    expect(r.y + r.h).toBeGreaterThan(desk.y);
    expect(desk.y + desk.h).toBe(800);
  });

  it('never exceeds the box width on a squat box', () => {
    const r = characterRect('center', { w: 200, h: 800 });
    expect(r.w).toBe(200);
    expect(LAYOUT_HEIGHT.center).toBeGreaterThan(LAYOUT_HEIGHT.left);
    expect(LAYOUT_HEIGHT.left).toBeGreaterThan(LAYOUT_HEIGHT.desk);
  });
});

describe('containRect', () => {
  it('bottom-aligns a wider-than-outer image', () => {
    const r = containRect({ x: 0, y: 0, w: 100, h: 200 }, 1);
    expect(r).toEqual({ x: 0, y: 100, w: 100, h: 100 });
  });

  it('centres a taller-than-outer image horizontally', () => {
    const r = containRect({ x: 10, y: 0, w: 200, h: 100 }, 0.5);
    expect(r).toEqual({ x: 85, y: 0, w: 50, h: 100 });
  });

  it('returns the outer rect for a degenerate aspect', () => {
    const outer = { x: 0, y: 0, w: 10, h: 10 };
    expect(containRect(outer, 0)).toBe(outer);
  });
});

describe('mouthRect ⇄ anchorFromRect', () => {
  const body = { x: 50, y: 100, w: 300, h: 400 };

  it('places the anchor fractions inside the body rect', () => {
    const r = mouthRect({ x: 0.4, y: 0.5, w: 0.2, h: 0.1 }, body);
    expect(r).toEqual({ x: 170, y: 300, w: 60, h: 40 });
  });

  it('round-trips to three decimals with the rotate', () => {
    const anchor = { x: 0.457, y: 0.512, w: 0.131, h: 0.062, rotate: 2.5 };
    const back = anchorFromRect(mouthRect(anchor, body), body, anchor.rotate);
    expect(back).toEqual(anchor);
  });

  it('clamps an anchor into the unit square', () => {
    expect(clampAnchor({ x: -0.2, y: 0.95, w: 0.3, h: 0.2 })).toEqual({
      x: 0,
      y: 0.8,
      w: 0.3,
      h: 0.2,
    });
    expect(clampAnchor({ x: 0.5, y: 0.5, w: 2, h: 0, rotate: 5 })).toEqual({
      x: 0,
      y: 0.5,
      w: 1,
      h: 0.01,
      rotate: 5,
    });
  });

  it('the placeholder anchor sits in the lower half of the face', () => {
    expect(PLACEHOLDER_MOUTH_ANCHOR.y).toBeGreaterThan(0.4);
    expect(PLACEHOLDER_MOUTH_ANCHOR.y + PLACEHOLDER_MOUTH_ANCHOR.h).toBeLessThan(0.6);
    expect(PLACEHOLDER_MOUTH_ANCHOR.x + PLACEHOLDER_MOUTH_ANCHOR.w / 2).toBeCloseTo(0.5, 1);
  });
});
