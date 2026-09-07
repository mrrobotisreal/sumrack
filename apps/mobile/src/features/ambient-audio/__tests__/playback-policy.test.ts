import { describe, expect, it } from 'vitest';

import { shouldPlayAmbience } from '../playback-policy';
import { DEFAULT_AMBIENT_PREFS, parseAmbientPrefs } from '../preferences';

const reader = {
  ready: true,
  foreground: true,
  studying: true,
  blocked: false,
  speaking: false,
  narrating: true,
};

describe('narration preference', () => {
  it('mixes by default, pauses when opted out, and resumes after narration pauses or ends', () => {
    expect(shouldPlayAmbience(DEFAULT_AMBIENT_PREFS, reader)).toBe(true);
    const prefs = { ...DEFAULT_AMBIENT_PREFS, playDuringNarration: false };
    expect(shouldPlayAmbience(prefs, reader)).toBe(false);
    expect(shouldPlayAmbience(prefs, { ...reader, narrating: false })).toBe(true);
  });

  it('does not let mixing bypass other audio or lifecycle restrictions', () => {
    for (const patch of [
      { ready: false },
      { foreground: false },
      { studying: false },
      { blocked: true },
      { speaking: true },
    ]) {
      expect(shouldPlayAmbience(DEFAULT_AMBIENT_PREFS, { ...reader, ...patch })).toBe(false);
    }
    expect(shouldPlayAmbience({ ...DEFAULT_AMBIENT_PREFS, enabled: false }, reader)).toBe(false);
    expect(shouldPlayAmbience({ ...DEFAULT_AMBIENT_PREFS, volume: 0 }, reader)).toBe(false);
  });
});

describe('slider preference migration', () => {
  it('preserves existing volume and mute selections and defaults narration to on', () => {
    expect(parseAmbientPrefs({ enabled: false, volume: 0.08 })).toEqual({
      enabled: false,
      volume: 0.08,
      playDuringNarration: true,
    });
    expect(parseAmbientPrefs({ enabled: true, volume: 0.15 }).volume).toBe(0.2);
  });

  it('round-trips manual volumes including the old preset value without upgrading them', () => {
    for (const volume of [0, 0.15, 0.2, 0.37, 1]) {
      const prefs = { enabled: true, volume, playDuringNarration: false };
      expect(parseAmbientPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    }
  });

  it('rejects a malformed narration preference', () => {
    expect(parseAmbientPrefs({ playDuringNarration: 'false' }).playDuringNarration).toBe(true);
  });
});
