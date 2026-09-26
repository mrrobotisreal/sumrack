import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isRoundVowelWord,
  ladderLevel,
  mouthTrackForFile,
  mouthTrackFromPcm,
  mouthTrackLength,
  parseWav16,
  visemesFromLevels,
} from '../src/mouth-track.ts';

/**
 * T57 mouth-track tests: synthetic PCM (silence / tone bursts / jitter
 * across a threshold), stamp gating, the round rule, the WAV parser, and the
 * ffmpeg path on a generated file. No provider, no fixture audio needed.
 */

const RATE = 44_100;
const STEP_SAMPLES = (RATE * 40) / 1000; // 1764

/** A mono signal: per-40 ms-window amplitude (0..1) → sine at that amplitude. */
function synth(windowAmps: readonly number[]): Float32Array {
  const out = new Float32Array(windowAmps.length * STEP_SAMPLES);
  windowAmps.forEach((amp, w) => {
    for (let i = 0; i < STEP_SAMPLES; i++) {
      const t = (w * STEP_SAMPLES + i) / RATE;
      out[w * STEP_SAMPLES + i] = amp * Math.sin(2 * Math.PI * 220 * t);
    }
  });
  return out;
}

/** Amplitude of a sine whose RMS sits at `db` dBFS. */
function ampForDb(db: number): number {
  return Math.SQRT2 * 10 ** (db / 20);
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('ladder + hysteresis', () => {
  it('maps dBFS to the five visemes at the documented boundaries', () => {
    expect(ladderLevel(-60)).toBe(0);
    expect(ladderLevel(-42.01)).toBe(0);
    expect(ladderLevel(-42)).toBe(1);
    expect(ladderLevel(-32)).toBe(2);
    expect(ladderLevel(-24)).toBe(3);
    expect(ladderLevel(-17)).toBe(4);
    expect(ladderLevel(0)).toBe(4);
  });

  it('holds the level across a ±1 dB jitter at a boundary', () => {
    // Hovering around −32 (the 1|2 boundary) without ever clearing it by 2 dB:
    // from rest the values pass −40 (0→1) but never reach −30, so 1 holds.
    const jitter = [-33, -31, -33, -31, -33, -31];
    expect(visemesFromLevels(jitter)).toEqual([1, 1, 1, 1, 1, 1]);
    // Once at 2 (cleared −30), the same jitter stays at 2.
    expect(visemesFromLevels([-29, ...jitter])).toEqual([2, 2, 2, 2, 2, 2, 2]);
    // Dropping to −35 (below −32 − 2) releases to 1; −45 releases to 0.
    expect(visemesFromLevels([-29, -35, -45])).toEqual([2, 1, 0]);
  });

  it('climbs several rungs in one window when the signal jumps', () => {
    expect(visemesFromLevels([-60, -10, -60])).toEqual([0, 4, 0]);
  });
});

describe('mouthTrackFromPcm (synthetic PCM)', () => {
  it('silence is all zeros with the schema length', () => {
    const samples = new Float32Array(RATE); // 1 s
    const track = mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 1000 });
    expect(track).toBe('0'.repeat(25));
    expect(track.length).toBe(mouthTrackLength(1000));
  });

  it('tone bursts climb the ladder by loudness', () => {
    const amps = [0, ampForDb(-38), ampForDb(-28), ampForDb(-20), ampForDb(-10), 0];
    const samples = synth(amps);
    const track = mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: amps.length * 40 });
    expect(track).toBe('012340');
  });

  it('track length follows durationMs, not the sample count (±1 rule)', () => {
    const samples = synth([ampForDb(-10), ampForDb(-10)]);
    // 90 ms → ceil(90/40) = 3 windows; the third has 10 ms of loud audio.
    expect(mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 90 })).toHaveLength(3);
    // 200 ms → 5 windows; the missing samples read as silence.
    expect(mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 200 })).toBe('44000');
  });

  it('forces 0 outside word stamps when stamps are present, leaves gaps untouched otherwise', () => {
    // 10 loud windows (400 ms); stamps cover [0,160) and [240,400).
    const samples = synth(Array.from({ length: 10 }, () => ampForDb(-10)));
    const sentence = {
      id: 's1',
      tokens: [{ text: 'Привет' }, { text: 'мир' }],
    };
    const stamps = [
      { sentenceId: 's1', tokenIndex: 0, startMs: 0, endMs: 160 },
      { sentenceId: 's1', tokenIndex: 1, startMs: 240, endMs: 400 },
    ];
    const gated = mouthTrackFromPcm({
      samples,
      sampleRate: RATE,
      durationMs: 400,
      stamps,
      sentence,
    });
    expect(gated).toBe('4444004444');
    const ungated = mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 400, sentence });
    expect(ungated).toBe('4'.repeat(10));
  });

  it('round rule: windows inside an о/у/ю/ё-first-vowel word become 4', () => {
    // Moderate level (viseme 2) throughout; word 1 «хорошо» is round, word 2 «спасибо» is not.
    const samples = synth(Array.from({ length: 10 }, () => ampForDb(-28)));
    const sentence = { id: 's1', tokens: [{ text: 'Хорошо' }, { text: ',' }, { text: 'спасибо' }] };
    const stamps = [
      { sentenceId: 's1', tokenIndex: 0, startMs: 0, endMs: 200 },
      { sentenceId: 's1', tokenIndex: 2, startMs: 200, endMs: 400 },
    ];
    expect(
      mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 400, stamps, sentence }),
    ).toBe('4444422222');
  });

  it('round rule never opens a closed mouth (silence inside a round word stays 0)', () => {
    const samples = synth([ampForDb(-10), 0, ampForDb(-10)]);
    const sentence = { id: 's1', tokens: [{ text: 'утро' }] };
    const stamps = [{ sentenceId: 's1', tokenIndex: 0, startMs: 0, endMs: 120 }];
    expect(
      mouthTrackFromPcm({ samples, sampleRate: RATE, durationMs: 120, stamps, sentence }),
    ).toBe('404');
  });

  it('accepts Int16 samples (the WAV path) identically to Float32', () => {
    const f32 = synth([0, ampForDb(-20), ampForDb(-10)]);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.round(f32[i]! * 32767);
    expect(mouthTrackFromPcm({ samples: i16, sampleRate: RATE, durationMs: 120 })).toBe(
      mouthTrackFromPcm({ samples: f32, sampleRate: RATE, durationMs: 120 }),
    );
  });
});

describe('isRoundVowelWord', () => {
  it('reads the FIRST vowel only, case-insensitively, ё included', () => {
    expect(isRoundVowelWord('Хорошо')).toBe(true);
    expect(isRoundVowelWord('утро')).toBe(true);
    expect(isRoundVowelWord('Юля')).toBe(true);
    expect(isRoundVowelWord('ёлка')).toBe(true);
    expect(isRoundVowelWord('спасибо')).toBe(false); // first vowel а
    expect(isRoundVowelWord('Привет')).toBe(false);
    expect(isRoundVowelWord('—')).toBe(false);
  });
});

describe('parseWav16 + mouthTrackForFile (real ffmpeg)', () => {
  it('decodes a generated tone/silence file and tracks it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sumrak-mouth-test-'));
    tempDirs.push(dir);
    const wav = join(dir, 'tone.wav');
    // 0.4 s silence, 0.4 s tone at amplitude 0.5 (RMS ≈ −9 dBFS → 4), 0.4 s silence.
    execFileSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.5*sin(2*PI*220*t)*between(t\\,0.4\\,0.8):s=44100:d=1.2',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      wav,
    ]);
    const { samples, sampleRate } = parseWav16(readFileSync(wav));
    expect(sampleRate).toBe(44_100);
    expect(samples.length).toBeGreaterThanOrEqual(44_100 * 1.2 - 2);
    const track = mouthTrackForFile(wav, 1200, undefined, undefined);
    expect(track).toHaveLength(30);
    expect(track.slice(0, 9)).toBe('0'.repeat(9));
    expect(track.slice(11, 19)).toBe('4'.repeat(8));
    expect(track.slice(21)).toBe('0'.repeat(9));
  });
});
