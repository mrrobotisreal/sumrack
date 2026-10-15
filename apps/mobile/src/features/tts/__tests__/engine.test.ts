import { describe, expect, it } from 'vitest';

import { SYSTEM_VOICE_ID } from '../catalog';
import { clampRate, pickClipVoiceId, pickEngine } from '../engine';

const RUSLAN = 'piper-ru-ruslan';
const IRINA = 'piper-ru-irina';
const DENIS = 'piper-ru-denis';

describe('pickClipVoiceId (T85)', () => {
  it('returns the selected voice when it is an installed Piper voice', () => {
    expect(pickClipVoiceId(IRINA, [RUSLAN, IRINA])).toBe(IRINA);
  });

  it('system selected + Piper installed → first installed in catalog order', () => {
    // Catalog order is ruslan, irina, denis, dmitri — denis is listed first here
    // on purpose so the result cannot be the array order.
    expect(pickClipVoiceId(SYSTEM_VOICE_ID, [DENIS, IRINA])).toBe(IRINA);
  });

  it('selected Piper not installed + another installed → that other one', () => {
    expect(pickClipVoiceId('piper-ru-dmitri', [RUSLAN])).toBe(RUSLAN);
  });

  it('none installed → undefined', () => {
    expect(pickClipVoiceId(RUSLAN, [])).toBeUndefined();
    expect(pickClipVoiceId(SYSTEM_VOICE_ID, [])).toBeUndefined();
  });
});

describe('pickEngine', () => {
  it('uses the selected piper voice when installed', () => {
    expect(pickEngine(undefined, RUSLAN, [RUSLAN])).toEqual({
      engine: 'piper',
      voiceId: RUSLAN,
    });
  });

  it('falls back to system with zero voices installed (ticket acceptance)', () => {
    expect(pickEngine(undefined, RUSLAN, [])).toEqual({
      engine: 'system',
      voiceId: SYSTEM_VOICE_ID,
    });
  });

  it('routes the system selection to system even with voices installed', () => {
    expect(pickEngine(undefined, SYSTEM_VOICE_ID, [RUSLAN])).toEqual({
      engine: 'system',
      voiceId: SYSTEM_VOICE_ID,
    });
  });

  it('lets an explicit request override the app selection', () => {
    expect(pickEngine(IRINA, RUSLAN, [RUSLAN, IRINA])).toEqual({
      engine: 'piper',
      voiceId: IRINA,
    });
    expect(pickEngine(SYSTEM_VOICE_ID, RUSLAN, [RUSLAN])).toEqual({
      engine: 'system',
      voiceId: SYSTEM_VOICE_ID,
    });
  });

  it('routes unknown or uninstalled requests to system', () => {
    expect(pickEngine('piper-ru-vanished', RUSLAN, [RUSLAN]).engine).toBe('system');
    expect(pickEngine(IRINA, RUSLAN, [RUSLAN]).engine).toBe('system');
  });
});

describe('clampRate', () => {
  it('defaults absent/invalid rates to 1', () => {
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(0)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('clamps to the sane [0.5, 2] band', () => {
    expect(clampRate(0.2)).toBe(0.5);
    expect(clampRate(3)).toBe(2);
  });

  it('passes through narration-range rates untouched', () => {
    expect(clampRate(0.7)).toBe(0.7);
    expect(clampRate(1.25)).toBe(1.25);
  });
});
