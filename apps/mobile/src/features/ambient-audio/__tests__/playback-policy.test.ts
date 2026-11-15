import { describe, expect, it } from 'vitest';

import { shouldPlayAmbience } from '../playback-policy';
import { DEFAULT_AMBIENT_PREFS, parseAmbientPrefs } from '../preferences';
import { resolveAmbientDecision } from '../playback-policy';

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
      storyScores: true,
    });
    expect(parseAmbientPrefs({ enabled: true, volume: 0.15 }).volume).toBe(0.2);
  });

  it('round-trips manual volumes including the old preset value without upgrading them', () => {
    for (const volume of [0, 0.15, 0.2, 0.37, 1]) {
      const prefs = { enabled: true, volume, playDuringNarration: false, storyScores: false };
      expect(parseAmbientPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    }
  });

  it('rejects a malformed narration preference', () => {
    expect(parseAmbientPrefs({ playDuringNarration: 'false' }).playDuringNarration).toBe(true);
  });
});

describe('resolveAmbientDecision (T115 score vs bed vs off)', () => {
  const ctx = {
    ready: true,
    foreground: true,
    studying: true,
    blocked: false,
    speaking: false,
    narrating: true,
  };
  const ready = { downloaded: true, playing: true };

  it("an unscored part is exactly today's bed rule", () => {
    for (const playDuringNarration of [true, false]) {
      for (const narrating of [true, false]) {
        const prefs = { ...DEFAULT_AMBIENT_PREFS, playDuringNarration };
        const c = { ...ctx, narrating };
        expect(resolveAmbientDecision(prefs, c, null)).toEqual({
          source: 'bed',
          active: shouldPlayAmbience(prefs, c),
        });
      }
    }
  });

  it('every pref combination for a scored, downloaded part', () => {
    for (const enabled of [true, false]) {
      for (const storyScores of [true, false]) {
        for (const playDuringNarration of [true, false]) {
          for (const volume of [0, 0.2]) {
            const prefs = { enabled, volume, storyScores, playDuringNarration };
            const d = resolveAmbientDecision(prefs, ctx, ready);
            const label = JSON.stringify(prefs);
            if (!enabled) {
              expect(d, label).toEqual({ source: 'bed', active: false, unavailable: 'disabled' });
            } else if (!storyScores || !playDuringNarration) {
              expect(d, label).toEqual({
                source: 'bed',
                active: shouldPlayAmbience(prefs, ctx),
                unavailable: 'pref_off',
              });
            } else {
              expect(d, label).toEqual({ source: 'score', active: volume > 0 });
            }
          }
        }
      }
    }
  });

  it('storyScores off while narrating keeps the bed under the voice (playDuringNarration on)', () => {
    const d = resolveAmbientDecision({ ...DEFAULT_AMBIENT_PREFS, storyScores: false }, ctx, ready);
    expect(d).toEqual({ source: 'bed', active: true, unavailable: 'pref_off' });
  });

  it('playDuringNarration off = silence while narrating, the bed while paused', () => {
    const prefs = { ...DEFAULT_AMBIENT_PREFS, playDuringNarration: false };
    expect(resolveAmbientDecision(prefs, ctx, ready).active).toBe(false);
    expect(
      resolveAmbientDecision(prefs, { ...ctx, narrating: false }, { ...ready, playing: false }),
    ).toEqual({ source: 'bed', active: true, unavailable: 'pref_off' });
  });

  it('a score not downloaded yet falls back to the bed', () => {
    expect(
      resolveAmbientDecision(DEFAULT_AMBIENT_PREFS, ctx, { downloaded: false, playing: true }),
    ).toEqual({ source: 'bed', active: true, unavailable: 'not_downloaded' });
  });

  it('score mode: audible only while its narration plays; the bed never returns mid-part', () => {
    const paused = resolveAmbientDecision(
      DEFAULT_AMBIENT_PREFS,
      { ...ctx, narrating: false },
      { downloaded: true, playing: false },
    );
    expect(paused).toEqual({ source: 'score', active: false });
  });

  it('score mode keeps the foreground, blocker, speech and readiness guards', () => {
    for (const patch of [
      { ready: false },
      { foreground: false },
      { blocked: true },
      { speaking: true },
    ]) {
      expect(
        resolveAmbientDecision(DEFAULT_AMBIENT_PREFS, { ...ctx, ...patch }, ready).active,
      ).toBe(false);
    }
    // A reader overlay (studying=false) does not stop the score: the narration still plays.
    expect(
      resolveAmbientDecision(DEFAULT_AMBIENT_PREFS, { ...ctx, studying: false }, ready).active,
    ).toBe(true);
  });

  it('parses storyScores defensively (default ON)', () => {
    expect(parseAmbientPrefs({}).storyScores).toBe(true);
    expect(parseAmbientPrefs({ storyScores: false }).storyScores).toBe(false);
    expect(parseAmbientPrefs({ storyScores: 'no' }).storyScores).toBe(true);
  });
});
