import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { logError } from '@/services/error-log';

/**
 * T91 lift sound effects. Seven short bundled clips (assets/audio/hotel/,
 * generated once with ElevenLabs SFX; see SFX.md). Players are created once
 * per Lift mount and reused. No audio focus is requested: these are short
 * UI cues and other apps must not pause for them (T78 focus rules cover
 * learning clips only).
 *
 * Quiet hours: the setting `hotel.sfx` (default on) silences every clip.
 * Haptics and visuals are unaffected. The setting is read once per mount,
 * and the Lift passes it in, so the playback here stays a plain function.
 */

export const LIFT_SFX_SOURCES = {
  close: require('../../../../assets/audio/hotel/lift-close.opus') as number,
  ride: require('../../../../assets/audio/hotel/lift-ride.opus') as number,
  ding: require('../../../../assets/audio/hotel/lift-ding.opus') as number,
  open: require('../../../../assets/audio/hotel/lift-open.opus') as number,
  flicker: require('../../../../assets/audio/hotel/flicker.opus') as number,
  drop: require('../../../../assets/audio/hotel/drop.opus') as number,
  blocked: require('../../../../assets/audio/hotel/lift-blocked.opus') as number,
} as const;

export type LiftSfxName = keyof typeof LIFT_SFX_SOURCES;

/** The 0.8× rate the ticket asks for on the slow creak in the reduced-motion-off drop. */
export const CREAK_RATE = 0.8;

export interface LiftSfx {
  /** Plays a clip from the start. */
  play: (name: Exclude<LiftSfxName, 'ride'>, opts?: { rate?: number }) => void;
  /** Starts the looping car hum. */
  startRide: () => void;
  /** Fades the hum out over `ms` and stops it. */
  stopRide: (ms?: number) => void;
  /** Releases every player. */
  dispose: () => void;
}

/** Reads the setting once; defaults to on. A read failure leaves the sound on. */
export async function readHotelSfxEnabled(): Promise<boolean> {
  try {
    const raw = await repos.settings.get<unknown>(SETTING_KEYS.hotelSfx);
    return raw !== false;
  } catch (err) {
    logError('manual', err);
    return true;
  }
}

/**
 * Creates the players. When `enabled` is false every method is a silent
 * no-op, so the Lift's call sites never branch on the setting.
 */
export function createLiftSfx(enabled: boolean): LiftSfx {
  if (!enabled) {
    return { play: () => {}, startRide: () => {}, stopRide: () => {}, dispose: () => {} };
  }

  const players = new Map<LiftSfxName, AudioPlayer>();
  const get = (name: LiftSfxName): AudioPlayer => {
    let player = players.get(name);
    if (!player) {
      player = createAudioPlayer(LIFT_SFX_SOURCES[name], { updateInterval: 60_000 });
      players.set(name, player);
    }
    return player;
  };
  let rideTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    play(name, opts) {
      try {
        const player = get(name);
        player.setPlaybackRate(opts?.rate ?? 1, 'high');
        player.seekTo(0);
        player.play();
      } catch (err) {
        logError('manual', err);
      }
    },
    startRide() {
      try {
        if (rideTimer) clearTimeout(rideTimer);
        rideTimer = null;
        const player = get('ride');
        player.loop = true;
        player.volume = 1;
        player.seekTo(0);
        player.play();
      } catch (err) {
        logError('manual', err);
      }
    },
    stopRide(ms = 0) {
      const player = players.get('ride');
      if (!player) return;
      if (ms <= 0) {
        player.pause();
        return;
      }
      // Fade out on a JS timer. The ride is a single audio player, so a
      // short volume ramp here is not frame-critical motion (the visual motion
      // stays on the UI thread).
      const steps = 8;
      const start = player.volume;
      let i = 0;
      if (rideTimer) clearTimeout(rideTimer);
      const tick = () => {
        i += 1;
        player.volume = Math.max(0, start * (1 - i / steps));
        if (i >= steps) {
          player.pause();
          player.volume = start;
          rideTimer = null;
          return;
        }
        rideTimer = setTimeout(tick, ms / steps);
      };
      rideTimer = setTimeout(tick, ms / steps);
    },
    dispose() {
      if (rideTimer) clearTimeout(rideTimer);
      rideTimer = null;
      for (const player of players.values()) {
        try {
          player.remove();
        } catch (err) {
          logError('manual', err);
        }
      }
      players.clear();
    },
  };
}
