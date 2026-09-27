import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';

import { useQuietStudy } from '@/features/ambient-audio/activity';
import { logError } from '@/services/error-log';

import { BED_DUCK, DEFAULT_BED_VOLUME, findSceneBed, type SceneBed } from './beds';

/**
 * Scene bed playback (T61, §8.4): its own `expo-audio` player (never the
 * M15 controller), looping, at `volume` (T62 passes `prefs.bedVolume`),
 * ducked to 35 % while `ducked` (a line plays / the mic records), stopped
 * and released when inactive or unmounted. The M15 study bed is paused for
 * the scenario's focused lifetime through `useQuietStudy` (the existing
 * blocker). Unknown slug / no asset ⇒ nothing plays, no error (§12).
 */

const FADE_STEPS = 6;
const FADE_MS = 240;

export interface SceneBedState {
  bed: SceneBed | undefined;
  /** A player exists for this bed (it is looping at the faded volume). */
  playing: boolean;
}

export function useSceneBed(
  slug: string | null | undefined,
  opts: { active: boolean; ducked: boolean; volume?: number },
): SceneBedState {
  const { active, ducked } = opts;
  const volume = opts.volume ?? DEFAULT_BED_VOLUME;
  const bed = findSceneBed(slug);
  const audible = active && bed != null && volume > 0;
  const target = Math.min(1, Math.max(0, volume * (ducked ? BED_DUCK : 1)));

  const playerRef = React.useRef<AudioPlayer | null>(null);
  const fadeRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  useQuietStudy(active);

  const stopFade = React.useCallback(() => {
    if (fadeRef.current) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  /** Ease the live player toward `to` over ~240 ms (never a click). */
  const fadeTo = React.useCallback(
    (to: number) => {
      const player = playerRef.current;
      if (!player) return;
      stopFade();
      const from = player.volume;
      let step = 0;
      fadeRef.current = setInterval(() => {
        step += 1;
        const p = playerRef.current;
        if (!p) {
          stopFade();
          return;
        }
        p.volume = from + ((to - from) * step) / FADE_STEPS;
        if (step >= FADE_STEPS) {
          p.volume = to;
          stopFade();
        }
      }, FADE_MS / FADE_STEPS);
    },
    [stopFade],
  );

  // Player lifecycle: one per (bed, audible) — created looping, faded in.
  React.useEffect(() => {
    if (!audible || !bed) return;
    let player: AudioPlayer;
    try {
      player = createAudioPlayer(bed.source, { updateInterval: 1000 });
    } catch (err) {
      logError('manual', err);
      return;
    }
    player.loop = true;
    player.volume = 0;
    player.play();
    playerRef.current = player;
    return () => {
      stopFade();
      playerRef.current = null;
      try {
        player.pause();
        player.release();
      } catch (err) {
        logError('manual', err);
      }
    };
  }, [audible, bed, stopFade]);

  // Fade-in after creation + every duck / volume change on the live player.
  React.useEffect(() => {
    fadeTo(target);
    return stopFade;
  }, [audible, bed, target, fadeTo, stopFade]);

  return { bed, playing: audible };
}
