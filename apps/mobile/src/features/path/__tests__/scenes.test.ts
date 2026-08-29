import { describe, expect, it } from 'vitest';

import { colors } from '@/theme/colors';

import { HOUSE_ROOMS } from '../house-map/rooms';
import {
  SCENE_IDS,
  SCENE_PRIMARY_LOOP_MS,
  scenePalette,
  THRESHOLD_ENTER_MS,
  THRESHOLD_EXIT_MS,
  withAlpha,
} from '../scenes/scene-palette';

describe('scene registry identity (T31)', () => {
  it('SCENE_IDS matches HOUSE_ROOMS exactly — rooms.ts is the room-identity registry', () => {
    expect([...SCENE_IDS].sort()).toEqual(HOUSE_ROOMS.map((r) => r.scene).sort());
  });

  it('every scene has a primary loop inside the 8–20 s motion budget (V2 §5.3)', () => {
    for (const scene of SCENE_IDS) {
      const loop = SCENE_PRIMARY_LOOP_MS[scene];
      expect(loop, scene).toBeGreaterThanOrEqual(8000);
      expect(loop, scene).toBeLessThanOrEqual(20000);
    }
  });

  it('threshold transitions stay under the 800 ms ceiling', () => {
    expect(THRESHOLD_ENTER_MS).toBeLessThanOrEqual(800);
    expect(THRESHOLD_EXIT_MS).toBeLessThanOrEqual(800);
    expect(THRESHOLD_EXIT_MS).toBeLessThan(THRESHOLD_ENTER_MS); // exit is the brief one
  });
});

describe('scenePalette', () => {
  const tokens = colors.dark;

  it('derives everything from theme tokens by default', () => {
    const palette = scenePalette(tokens, null);
    expect(palette.glow).toBe(tokens.accent);
    expect(palette.shadow).toBe(tokens.scrim);
    expect(palette.bg).toBe(tokens.bg);
    expect(palette.mist).toBe(tokens.textMuted);
  });

  it('a valid pack accent overrides the glow only', () => {
    const palette = scenePalette(tokens, '#8A4B2F');
    expect(palette.glow).toBe('#8A4B2F');
    expect(palette.shadow).toBe(tokens.scrim);
  });

  it('malformed accents fall back to the theme ember', () => {
    for (const bad of ['8A4B2F', '#8A4B2', '#8A4B2FF', '#xyzxyz', '', 'red']) {
      expect(scenePalette(tokens, bad).glow, bad).toBe(tokens.accent);
    }
  });

  it('works identically off the light tokens (deliberate daylight variant)', () => {
    const palette = scenePalette(colors.light, undefined);
    expect(palette.glow).toBe(colors.light.accent);
    expect(palette.bg).toBe(colors.light.bg);
  });
});

describe('withAlpha', () => {
  it('converts #RRGGBB + alpha to rgba()', () => {
    expect(withAlpha('#B3402F', 0.15)).toBe('rgba(179, 64, 47, 0.15)');
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
  });
});
