import type { AudioPlayer } from 'expo-audio';
import * as React from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { SentenceWithTokens } from '@/db/repositories/content';
import { buildKaraokeIndex } from '@/features/reader/karaoke';

import {
  buildRoundMask,
  MOUTH_TICK_MS,
  mouthShapeAt,
  muppetShapeAt,
  startMediaClock,
  syncMediaClock,
  type MediaClock,
} from './visemes';

/**
 * Mouth playback sync (T61, §8.2): a 40 ms `setInterval` reads the playing
 * line's `player.currentTime`, resolves the viseme through the pure track
 * math, and writes ONE shared value the `Mouth` selects its path from — no
 * React state, no re-render per tick. Recorded T61 choice: `setInterval`
 * over a throttled `useFrameCallback` because the player position is a
 * JS-thread read anyway (a UI-thread frame callback would have to hop to
 * JS every frame); 25 Hz is the track's own resolution.
 *
 * Missing track ⇒ the muppet fallback (2/0/3/1 at 90 ms) while `speaking`;
 * `speaking: false` (idle, or a суфлёр line — the host is not talking)
 * holds the mouth closed.
 */

export interface MouthLine {
  /** The pipeline track ('0'–'4' per 40 ms) or null (muppet fallback). */
  track: string | null;
  /** Per-step round mask (same length as `track`) — see `buildRoundMask`. */
  roundMask: string | null;
}

/** Resolve a line's track + round mask from the repo rows (memoise per line). */
export function mouthLineFor(
  audio: { mouth: string | null; durationMs: number } | null | undefined,
  sentence: Pick<SentenceWithTokens, 'id' | 'ru' | 'tokens'> | null | undefined,
  stamps: readonly { tokenIndex: number; startMs: number; endMs: number }[] | undefined,
): MouthLine {
  const track = audio?.mouth ?? null;
  if (!track || !sentence) return { track, roundMask: null };
  const index = buildKaraokeIndex(
    [{ id: sentence.id, ru: sentence.ru }],
    (stamps ?? []).map((s) => ({ sentenceId: sentence.id, ...s })),
    audio?.durationMs ?? track.length * MOUTH_TICK_MS,
  );
  const textByIndex = new Map(sentence.tokens.map((t) => [t.tokenIndex, t.text]));
  return { track, roundMask: buildRoundMask(track.length, index, (i) => textByIndex.get(i)) };
}

export function useMouthTrack(opts: {
  player: AudioPlayer | null;
  line: MouthLine | null;
  /** The host is speaking THIS line right now (false for idle and суфлёр lines). */
  speaking: boolean;
  /** Playback rate the line plays at (1.0 or 0.8) — used only to extrapolate a stale position read. */
  rate: number;
}): SharedValue<number> {
  const { player, line, speaking, rate } = opts;
  const shape = useSharedValue(0);

  React.useEffect(() => {
    if (!speaking) {
      shape.value = 0;
      return;
    }
    const startWall = Date.now();
    let clock: MediaClock | null = null;
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      let next = 0;
      if (line?.track != null && player) {
        let read: number;
        try {
          read = Math.round(player.currentTime * 1000);
        } catch {
          // The line's player was released under us (a replay/skip mid-line
          // — expo-audio throws on a released shared object): close the
          // mouth and stop ticking; the next line remounts this effect.
          if (id != null) clearInterval(id);
          id = null;
          shape.value = 0;
          return;
        }
        clock ??= startMediaClock(read, Date.now(), rate);
        const media = syncMediaClock(clock, read, Date.now());
        next = mouthShapeAt(line.track, line.roundMask, media) ?? 0;
      } else {
        next = muppetShapeAt(Date.now() - startWall);
      }
      if (shape.value !== next) shape.value = next;
    };
    tick();
    id = setInterval(tick, MOUTH_TICK_MS);
    return () => {
      if (id != null) clearInterval(id);
      shape.value = 0;
    };
  }, [player, line, speaking, rate, shape]);

  return shape;
}
