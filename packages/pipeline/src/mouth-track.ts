import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOUTH_TRACK_STEP_MS, type Sentence, type WordStamp } from '@sumrak/schema';
import { decodeToWav } from './opus.ts';

/**
 * Mouth tracks (T57, design SPEAKING_SCENARIOS §3 + §8.2): one viseme digit
 * per 40 ms of a rendered line, computed from the audio's own loudness so
 * the drawn cast opens its mouth when the voice does.
 *
 * Pure core over PCM samples ({@link mouthTrackFromPcm}); the file entry
 * point ({@link mouthTrackForFile}) decodes the Opus through ffmpeg first.
 *
 * Algorithm:
 * 1. RMS per {@link MOUTH_TRACK_STEP_MS} window → dBFS.
 * 2. dBFS → viseme by the ladder {@link MOUTH_LADDER_DB} (`< −42` → 0 ·
 *    `< −32` → 1 · `< −24` → 2 · `< −17` → 3 · else 4) with
 *    ±{@link MOUTH_HYSTERESIS_DB} hysteresis: a window has to clear a
 *    boundary by the margin to change level, so lips don't flicker on
 *    values that hover at a threshold.
 * 3. When the line's word stamps are trusted (non-empty), every window
 *    that overlaps no stamp is forced to `0` — breaths, room tone and
 *    provider tails never animate the mouth.
 * 4. Round rule: a non-closed window whose active stamp token's FIRST
 *    vowel is о/у/ю/ё encodes as `4`; the app re-derives the vowel from
 *    the current word and draws `4` round for those words, wide otherwise
 *    (§8.2 — one digit alphabet serves both). Stress is ignored (first
 *    vowel heuristic, recorded in the ticket).
 *
 * The track length is fixed from the audio duration (`ceil(durationMs /
 * 40)`), never from the sample count, so it always satisfies the schema's
 * ±1 rule regardless of decoder padding.
 */

/** Upper bounds (exclusive) of visemes 0..3 in dBFS; anything above the last is 4. */
export const MOUTH_LADDER_DB = [-42, -32, -24, -17] as const;
/** A window must clear a ladder boundary by this much to change level. */
export const MOUTH_HYSTERESIS_DB = 2;
/** Vowels whose words are drawn with the round mouth (§3 round rule). */
export const ROUND_VOWELS = new Set(['о', 'у', 'ю', 'ё']);
/** Floor for digital silence (rms 0) so the ladder math stays finite. */
const SILENCE_DB = -100;
const RUSSIAN_VOWELS = /[аеёиоуыэюя]/iu;

export interface MouthTrackInput {
  /** Mono PCM samples, −1..1 (Int16 scaled) or raw Int16 — see `sampleRate`. */
  samples: Float32Array | Int16Array;
  sampleRate: number;
  /** Audio duration in ms (the schema's `durationMs`); fixes the track length. */
  durationMs: number;
  /**
   * Trusted word stamps of the line (empty/absent ⇒ no stamp gating, RMS
   * alone decides). Only stamps into `sentence` matter for the round rule.
   */
  stamps?: readonly WordStamp[];
  /** The line's sentence — token text for the round rule. */
  sentence?: Pick<Sentence, 'id' | 'tokens'>;
}

/** Does this token's first vowel call for the round mouth? */
export function isRoundVowelWord(text: string): boolean {
  const m = RUSSIAN_VOWELS.exec(text.normalize('NFC'));
  return m !== null && ROUND_VOWELS.has(m[0]!.toLowerCase());
}

/** RMS level of one window in dBFS (Int16 full scale = 0 dB). */
function windowDb(samples: Float32Array | Int16Array, start: number, end: number): number {
  const scale = samples instanceof Int16Array ? 32768 : 1;
  let sum = 0;
  let n = 0;
  for (let i = start; i < end && i < samples.length; i++) {
    const v = samples[i]! / scale;
    sum += v * v;
    n++;
  }
  if (n === 0 || sum === 0) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(Math.sqrt(sum / n)));
}

/** Raw ladder level with no hysteresis (tests + the initial state). */
export function ladderLevel(db: number): number {
  let level = 0;
  while (level < MOUTH_LADDER_DB.length && db >= MOUTH_LADDER_DB[level]!) level++;
  return level;
}

/**
 * Per-window dBFS → viseme levels with hysteresis. Exported for tests: the
 * ladder alone, no stamps, no round rule.
 */
export function visemesFromLevels(dbPerWindow: readonly number[]): number[] {
  const out: number[] = [];
  let level = 0;
  for (const db of dbPerWindow) {
    // Climb while the value clears the NEXT boundary by the margin; descend
    // while it falls below the CURRENT band's floor by the margin.
    while (level < MOUTH_LADDER_DB.length && db >= MOUTH_LADDER_DB[level]! + MOUTH_HYSTERESIS_DB) {
      level++;
    }
    while (level > 0 && db < MOUTH_LADDER_DB[level - 1]! - MOUTH_HYSTERESIS_DB) {
      level--;
    }
    out.push(level);
  }
  return out;
}

/** The schema's track length for a duration. */
export function mouthTrackLength(durationMs: number): number {
  return Math.ceil(durationMs / MOUTH_TRACK_STEP_MS);
}

/** Compute the viseme digit string for one line from decoded PCM. */
export function mouthTrackFromPcm(input: MouthTrackInput): string {
  const { samples, sampleRate, durationMs } = input;
  const steps = mouthTrackLength(durationMs);
  const perWindow = (sampleRate * MOUTH_TRACK_STEP_MS) / 1000;
  const db: number[] = [];
  for (let w = 0; w < steps; w++) {
    const start = Math.round(w * perWindow);
    const end = Math.round((w + 1) * perWindow);
    db.push(windowDb(samples, start, end));
  }
  const levels = visemesFromLevels(db);

  const stamps = input.stamps ?? [];
  const gate = stamps.length > 0;
  const tokens = input.sentence?.tokens ?? [];
  const sentenceId = input.sentence?.id;
  const digits: string[] = [];
  for (let w = 0; w < steps; w++) {
    const winStart = w * MOUTH_TRACK_STEP_MS;
    const winEnd = winStart + MOUTH_TRACK_STEP_MS;
    let level = levels[w]!;
    if (gate) {
      // The stamp covering the window's midpoint wins; else any overlap.
      const mid = winStart + MOUTH_TRACK_STEP_MS / 2;
      const active =
        stamps.find((s) => s.startMs <= mid && mid < s.endMs) ??
        stamps.find((s) => s.startMs < winEnd && s.endMs > winStart);
      if (!active) {
        level = 0;
      } else if (level > 0 && active.sentenceId === sentenceId) {
        const text = tokens[active.tokenIndex]?.text;
        if (text !== undefined && isRoundVowelWord(text)) level = 4;
      }
    }
    digits.push(String(level));
  }
  return digits.join('');
}

/** Parse a 16-bit PCM WAV (as `decodeToWav` writes) into samples + rate. */
export function parseWav16(buf: Buffer): { samples: Int16Array; sampleRate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}-bit`);
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / 2 / channels);
      const samples = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        // Mono expected; fold extra channels by taking the first.
        samples[i] = buf.readInt16LE(body + i * 2 * channels);
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/**
 * Mouth track for a rendered file: decode to PCM via ffmpeg, then
 * {@link mouthTrackFromPcm}. `stamps` should be the line's shipped
 * (trusted) stamps or empty.
 */
export function mouthTrackForFile(
  audioFile: string,
  durationMs: number,
  stamps: readonly WordStamp[] | undefined,
  sentence: Pick<Sentence, 'id' | 'tokens'> | undefined,
): string {
  const work = mkdtempSync(join(tmpdir(), 'sumrak-mouth-'));
  try {
    const wav = join(work, 'line.wav');
    decodeToWav(audioFile, wav);
    const { samples, sampleRate } = parseWav16(readFileSync(wav));
    return mouthTrackFromPcm({ samples, sampleRate, durationMs, stamps, sentence });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
