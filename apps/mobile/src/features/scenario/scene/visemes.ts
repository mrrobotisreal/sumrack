import { MOUTH_TRACK_STEP_MS } from '@sumrak/schema';

import { activeWordAt, type KaraokeIndex } from '@/features/reader/karaoke';

/**
 * Viseme playback math (T61, §8.2) — pure, no RN imports. The pipeline's
 * mouth track is one digit per 40 ms ('0' closed … '4' wide); the renderer
 * has SIX shapes because the round rule turns a '4' into shape 5 (round)
 * when the word being spoken opens on о/у/ю/ё. The rule is resolved once per
 * line into a mask (one char per step) so the 25 Hz tick does a lookup, not
 * a karaoke search.
 */

/** Renderer shape ids: 0 closed · 1 narrow · 2 mid oval · 3 open oval · 4 wide · 5 round. */
export type MouthShape = 0 | 1 | 2 | 3 | 4 | 5;

export const MOUTH_SHAPES: readonly MouthShape[] = [0, 1, 2, 3, 4, 5];

/** Shapes that show the tooth/tongue highlight (§8.1 item 5: only `3`/`4`, and the round `4`). */
export const OPEN_SHAPES: ReadonlySet<MouthShape> = new Set<MouthShape>([3, 4, 5]);

/** Muppet fallback (§8.2): a line without a track alternates these while the host speaks. */
export const MUPPET_SEQUENCE: readonly MouthShape[] = [2, 0, 3, 1];
export const MUPPET_STEP_MS = 90;

/** The 25 Hz tick. */
export const MOUTH_TICK_MS = MOUTH_TRACK_STEP_MS;

const ROUND_VOWELS = new Set(['о', 'у', 'ю', 'ё']);
const VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я']);

/** True when the word's FIRST vowel is о/у/ю/ё (stressless heuristic, T57's rule). */
export function isRoundWord(word: string): boolean {
  for (const ch of word.toLowerCase()) {
    if (VOWELS.has(ch)) return ROUND_VOWELS.has(ch);
  }
  return false;
}

/** Track step index for a media time. */
export function stepIndexAt(mediaMs: number): number {
  return Math.floor(mediaMs / MOUTH_TRACK_STEP_MS);
}

/**
 * Per-step round mask for a line: '1' where the active word (T10
 * `activeWordAt` on the line's stamps, sampled mid-step) is a round word.
 * `wordAt(tokenIndex)` resolves the sentence token text. Same length as the
 * track; all '0' when there are no stamps (round never applies).
 */
export function buildRoundMask(
  trackLength: number,
  index: KaraokeIndex | null,
  wordAt: (tokenIndex: number) => string | undefined,
): string {
  if (trackLength <= 0) return '';
  if (!index || index.mode !== 'word') return '0'.repeat(trackLength);
  const roundByToken = new Map<number, boolean>();
  let out = '';
  for (let i = 0; i < trackLength; i++) {
    const active = activeWordAt(index, i * MOUTH_TRACK_STEP_MS + MOUTH_TRACK_STEP_MS / 2);
    if (!active) {
      out += '0';
      continue;
    }
    let round = roundByToken.get(active.tokenIndex);
    if (round === undefined) {
      round = isRoundWord(wordAt(active.tokenIndex) ?? '');
      roundByToken.set(active.tokenIndex, round);
    }
    out += round ? '1' : '0';
  }
  return out;
}

/**
 * The shape to show at `mediaMs`: the track digit, promoted to 5 (round)
 * when the digit is 4 and the mask says so; 0 outside the track. `null`
 * track ⇒ null (caller runs the muppet fallback).
 */
export function mouthShapeAt(
  track: string | null,
  roundMask: string | null,
  mediaMs: number,
): MouthShape | null {
  if (track == null) return null;
  const idx = stepIndexAt(mediaMs);
  if (idx < 0 || idx >= track.length) return 0;
  const digit = track.charCodeAt(idx) - 48;
  if (digit < 0 || digit > 4) return 0;
  if (digit === 4 && roundMask != null && roundMask.charAt(idx) === '1') return 5;
  return digit as MouthShape;
}

/** Muppet shape for an elapsed speaking time. */
export function muppetShapeAt(elapsedMs: number): MouthShape {
  const i = Math.floor(Math.max(0, elapsedMs) / MUPPET_STEP_MS) % MUPPET_SEQUENCE.length;
  return MUPPET_SEQUENCE[i]!;
}

/**
 * `player.currentTime` is a JS-thread read; on Android it advances with the
 * media clock but can repeat a value between position updates under load.
 * The tick keeps a wall-clock anchor: a changed reading re-anchors, an
 * unchanged one is extrapolated at the playback rate — so the lips never
 * stall on a stale read and never run ahead of a real one.
 */
export interface MediaClock {
  anchorMediaMs: number;
  anchorWallMs: number;
  lastReadMs: number;
  rate: number;
}

export function startMediaClock(mediaMs: number, wallMs: number, rate: number): MediaClock {
  return { anchorMediaMs: mediaMs, anchorWallMs: wallMs, lastReadMs: mediaMs, rate };
}

/** Feed one `currentTime` reading; returns the media time to render at. */
export function syncMediaClock(clock: MediaClock, readMs: number, wallMs: number): number {
  if (readMs !== clock.lastReadMs) {
    clock.anchorMediaMs = readMs;
    clock.anchorWallMs = wallMs;
    clock.lastReadMs = readMs;
    return readMs;
  }
  return clock.anchorMediaMs + (wallMs - clock.anchorWallMs) * clock.rate;
}
