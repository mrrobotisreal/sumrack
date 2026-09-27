import { describe, expect, it } from 'vitest';

import {
  CAP_MS,
  endpointConfig,
  endpointManualStop,
  endpointStep,
  INITIAL_ENDPOINT,
  LOUD_LEVEL,
  NO_SPEECH_MS,
  runEndpointStream,
  START_CONSECUTIVE,
  START_LEVEL,
  TRAIL_MS,
  type LevelEvent,
} from '../engine/endpointing';

/** Endpointing (T60, SPEAKING_SCENARIOS §7.1) on synthetic ~8 Hz level streams. */

const TICK = 125; // ~8 Hz

/** Build a stream: `pattern` letters — q quiet, s speech — one event per tick. */
function stream(pattern: string, quiet = 0.01, loud = 0.3): LevelEvent[] {
  return [...pattern].map((c, i) => ({
    level: c === 's' ? loud : quiet,
    elapsedMs: (i + 1) * TICK,
  }));
}
const ticks = (ms: number) => Math.ceil(ms / TICK);

describe('constants (§7.1, recorded)', () => {
  it('presets + cap + no-speech + starting levels', () => {
    expect(TRAIL_MS).toEqual({ quick: 800, normal: 1100, patient: 1600 });
    expect(CAP_MS).toBe(20_000);
    expect(NO_SPEECH_MS).toBe(6000);
    expect(START_LEVEL).toBe(0.08);
    expect(LOUD_LEVEL).toBe(0.05);
    expect(START_CONSECUTIVE).toBe(2);
    expect(endpointConfig('quick').sensitivity).toBe('quick');
    expect(endpointConfig('normal', { startLevel: 0.12 }).startLevel).toBe(0.12);
  });
});

describe('endpointStep', () => {
  it('a single loud event is not speech; two consecutive are', () => {
    const cfg = endpointConfig();
    let s = INITIAL_ENDPOINT;
    s = endpointStep(s, { level: 0.5, elapsedMs: 125 }, cfg).state;
    expect(s.phase).toBe('armed');
    expect(s.loudRun).toBe(1);
    s = endpointStep(s, { level: 0.01, elapsedMs: 250 }, cfg).state;
    expect(s.loudRun).toBe(0);
    s = endpointStep(s, { level: 0.5, elapsedMs: 375 }, cfg).state;
    s = endpointStep(s, { level: 0.5, elapsedMs: 500 }, cfg).state;
    expect(s.phase).toBe('speaking');
    expect(s.speechStartMs).toBe(375);
    expect(s.peak).toBe(0.5);
  });

  it('stops on trailing silence per preset (quick 800 · normal 1100 · patient 1600)', () => {
    for (const preset of ['quick', 'normal', 'patient'] as const) {
      const events = stream('ssssssss' + 'q'.repeat(20));
      const r = runEndpointStream(events, endpointConfig(preset));
      expect(r.stop?.reason, preset).toBe('silence');
      const lastLoud = 8 * TICK;
      const stoppedAt = events[r.stoppedAtIndex!]!.elapsedMs;
      expect(stoppedAt - lastLoud, preset).toBeGreaterThanOrEqual(TRAIL_MS[preset]);
      expect(stoppedAt - lastLoud, preset).toBeLessThan(TRAIL_MS[preset] + TICK);
      expect(r.stop?.speechStartMs).toBe(TICK);
      expect(r.stop?.speechMs).toBe(lastLoud - TICK);
    }
  });

  it('a pause shorter than the window keeps speaking; the quieter LOUD_LEVEL sustains speech', () => {
    const cfg = endpointConfig('normal');
    // 6 loud, 5 quiet (625 ms < 1100), 6 loud, then silence.
    const r = runEndpointStream(stream('ssssss' + 'qqqqq' + 'ssssss' + 'q'.repeat(15)), cfg);
    expect(r.stop?.reason).toBe('silence');
    expect(r.stop?.speechMs).toBe(17 * TICK - TICK);
    // Levels between LOUD_LEVEL and START_LEVEL keep it alive once speaking.
    const soft = [
      ...stream('ss'),
      ...Array.from({ length: 20 }, (_, i) => ({ level: 0.06, elapsedMs: (i + 3) * TICK })),
    ];
    expect(runEndpointStream(soft, cfg).stop).toBeNull();
    // …but never START it.
    const tooSoft = Array.from({ length: 10 }, (_, i) => ({
      level: 0.06,
      elapsedMs: (i + 1) * TICK,
    }));
    expect(runEndpointStream(tooSoft, cfg).state.phase).toBe('armed');
  });

  it('6 s with no speech ⇒ no-speech', () => {
    const r = runEndpointStream(stream('q'.repeat(ticks(NO_SPEECH_MS) + 4)), endpointConfig());
    expect(r.stop?.reason).toBe('no-speech');
    expect(r.stop?.speechStartMs).toBeNull();
    expect(r.stop?.speechMs).toBe(0);
    expect(events(r.stoppedAtIndex!)).toBeGreaterThanOrEqual(NO_SPEECH_MS);
  });

  it('a lone click before the deadline does not reset the no-speech clock', () => {
    const pattern = 'q'.repeat(10) + 's' + 'q'.repeat(ticks(NO_SPEECH_MS));
    const r = runEndpointStream(stream(pattern), endpointConfig());
    expect(r.stop?.reason).toBe('no-speech');
  });

  it('the 20 s cap stops a never-ending talker', () => {
    const r = runEndpointStream(stream('s'.repeat(ticks(CAP_MS) + 10)), endpointConfig('patient'));
    expect(r.stop?.reason).toBe('cap');
    expect(r.stop?.speechMs).toBeGreaterThan(19_000);
  });

  it('a noisy room that never crosses START_LEVEL twice in a row is no-speech at 6 s (the cap only if that clock is longer)', () => {
    const noisy = Array.from({ length: ticks(CAP_MS) + 2 }, (_, i) => ({
      level: i % 2 === 0 ? 0.2 : 0.01, // never 2 consecutive
      elapsedMs: (i + 1) * TICK,
    }));
    expect(runEndpointStream(noisy, endpointConfig()).stop?.reason).toBe('no-speech');
    expect(
      runEndpointStream(noisy, endpointConfig('normal', { noSpeechMs: 60_000 })).stop?.reason,
    ).toBe('cap');
  });

  it('manual tap and hold release stop with their own reasons', () => {
    const cfg = endpointConfig();
    let s = INITIAL_ENDPOINT;
    for (const e of stream('ssss')) s = endpointStep(s, e, cfg).state;
    const manual = endpointManualStop(s, 700);
    expect(manual.stop).toEqual({ reason: 'manual', speechStartMs: TICK, speechMs: 3 * TICK });
    const hold = endpointManualStop(INITIAL_ENDPOINT, 3000, 'hold');
    expect(hold.stop?.reason).toBe('hold');
    expect(hold.stop?.speechMs).toBe(0);
  });

  it('once stopped, further events are ignored', () => {
    const cfg = endpointConfig('quick');
    const r = runEndpointStream(stream('ss' + 'q'.repeat(10)), cfg);
    expect(r.stop?.reason).toBe('silence');
    const again = endpointStep(r.state, { level: 0.9, elapsedMs: 99_999 }, cfg);
    expect(again.stop).toBeNull();
    expect(again.state).toBe(r.state);
  });

  function events(i: number): number {
    return (i + 1) * TICK;
  }
});
