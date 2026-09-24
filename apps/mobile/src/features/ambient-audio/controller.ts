import { bedAfter, type AmbientBed, type AmbientTheme, type AmbientThemeId } from './beds';
import { nextStart, type AmbientCursor } from './cursors';

/** The slice of expo-audio's `AudioPlayer` the engine touches (fakeable in tests). */
export interface AmbientPlayer {
  volume: number;
  loop: boolean;
  /** Seconds. */
  currentTime: number;
  /** Seconds. */
  duration: number;
  play(): void;
  pause(): void;
  remove(): void;
  /** Swap the source on the same native player (keeps the audio session). */
  replace(source: number): void;
  seekTo(seconds: number): Promise<void>;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: AmbientStatus) => void,
  ): {
    remove(): void;
  };
}

/** The status fields the engine reads (expo-audio `AudioStatus` is a superset). */
export interface AmbientStatus {
  didJustFinish: boolean;
  playing: boolean;
  currentTime: number;
}

export type AmbientEngineEvent =
  'ambient_theme_started' | 'ambient_theme_switched' | 'ambient_bed_advanced';

export interface AmbientControllerDeps {
  themes: Record<AmbientThemeId, AmbientTheme>;
  getCursor(theme: AmbientThemeId): AmbientCursor | undefined;
  saveCursor(theme: AmbientThemeId, cursor: AmbientCursor): void;
  onEvent(event: AmbientEngineEvent, props: Record<string, string | number>): void;
  /** Injectable clock for the save throttle (defaults to `Date.now`). */
  now?: () => number;
}

/** Theme switches ramp the volume down and back up over this long (design §6). */
export const FADE_MS = 300;
export const FADE_STEPS = 10;
/** While playing, a cursor snapshot is written at most this often (design §6). */
export const CURSOR_SAVE_INTERVAL_MS = 15_000;

/**
 * Owns the ONE ambient player and walks the current theme's playlist (M15,
 * design AMBIENT_SOUNDTRACKS §6): starts at the persisted cursor, advances
 * on `didJustFinish`, wraps, loops single-bed themes, fades ≤ 300 ms across a
 * theme switch and stays instant on pause/resume. A stale async step (setup,
 * fade, seek) for a superseded target must never start audible playback —
 * every await is followed by a `revision` check.
 */
export function createAmbientController(
  prepare: () => Promise<void>,
  createPlayer: (source: number) => AmbientPlayer,
  onError: (error: unknown) => void,
  deps: AmbientControllerDeps,
) {
  const now = deps.now ?? Date.now;
  let player: AmbientPlayer | null = null;
  let subscription: { remove(): void } | null = null;
  let revision = 0;
  let disposed = false;
  let preparation: Promise<void> | null = null;
  /** What the player currently holds (assigned once `replace`/create succeeded). */
  let currentTheme: AmbientThemeId | null = null;
  let currentBed: AmbientBed | null = null;
  /** The host's last intent — an end-of-bed advance must not start audio while paused. */
  let wantPlaying = false;
  let lastSaveAt = -Infinity;
  /** Guards the ENDED re-emit race (`use-narration.ts`): one advance per finish. */
  let advancing = false;

  function saveCursorNow() {
    if (!player || !currentTheme || !currentBed) return;
    const positionMs = Math.max(0, Math.round((player.currentTime || 0) * 1000));
    deps.saveCursor(currentTheme, { bed: currentBed.slug, positionMs });
    lastSaveAt = now();
  }

  function pause() {
    wantPlaying = false;
    if (!player) return;
    // Synchronous: a backgrounded app suspends JS timers, so no fade here.
    player.volume = 0;
    player.pause();
    saveCursorNow();
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /** Linear ramp on the same player; returns false when superseded mid-ramp. */
  async function fadeTo(target: number, current: number): Promise<boolean> {
    if (!player) return false;
    const from = player.volume;
    if (from === target) return true;
    for (let step = 1; step <= FADE_STEPS; step++) {
      await sleep(FADE_MS / FADE_STEPS);
      if (disposed || revision !== current || !player) return false;
      player.volume = from + ((target - from) * step) / FADE_STEPS;
    }
    return true;
  }

  function advance() {
    if (!player || !currentTheme || !currentBed) return;
    const theme = deps.themes[currentTheme];
    if (theme.beds.length === 1) return; // `loop` handles single-bed themes.
    if (advancing) return;
    advancing = true;
    const from = currentBed;
    const to = bedAfter(currentTheme, from.slug);
    try {
      // A new source (and position 0) sidesteps the ENDED re-emit race.
      player.replace(to.source);
      currentBed = to;
      if (wantPlaying) player.play();
      deps.onEvent('ambient_bed_advanced', {
        theme: currentTheme,
        fromBed: from.slug,
        toBed: to.slug,
      });
      deps.saveCursor(currentTheme, { bed: to.slug, positionMs: 0 });
      lastSaveAt = now();
    } catch (error) {
      advancing = false;
      onError(error);
    }
  }

  function onStatus(status: AmbientStatus) {
    if (disposed || !player) return;
    if (status.didJustFinish) {
      advance();
      return;
    }
    if (!status.playing) return;
    advancing = false;
    if (now() - lastSaveAt >= CURSOR_SAVE_INTERVAL_MS) saveCursorNow();
  }

  return {
    async update(active: boolean, volume: number, theme: AmbientThemeId) {
      const current = ++revision;
      if (disposed) return;
      try {
        if (!active || volume <= 0) {
          pause();
          return;
        }
        preparation ??= prepare();
        await preparation;
        if (disposed || revision !== current) return;

        if (player && currentTheme === theme) {
          // Same theme: resume in place, instantly (today's behaviour).
          wantPlaying = true;
          player.volume = volume;
          player.play();
          return;
        }

        // First start or a theme switch: save the old cursor, fade out on the
        // same player, swap the source, seek to the new theme's cursor, fade in.
        const fromTheme = currentTheme;
        if (player) {
          saveCursorNow();
          if (!(await fadeTo(0, current))) return;
        }
        const start = nextStart(theme, deps.getCursor(theme));
        if (player) {
          player.replace(start.bed.source);
        } else {
          player = createPlayer(start.bed.source);
          subscription = player.addListener('playbackStatusUpdate', onStatus);
        }
        currentTheme = theme;
        currentBed = start.bed;
        advancing = false;
        player.loop = deps.themes[theme].beds.length === 1;
        player.volume = 0;
        if (start.positionMs > 0) {
          await player.seekTo(start.positionMs / 1000);
          if (disposed || revision !== current) return;
        }
        wantPlaying = true;
        player.play();
        lastSaveAt = now();
        deps.onEvent('ambient_theme_started', {
          theme,
          bed: start.bed.slug,
          resumedMs: start.positionMs,
        });
        if (fromTheme) deps.onEvent('ambient_theme_switched', { fromTheme, toTheme: theme });
        await fadeTo(volume, current);
      } catch (error) {
        preparation = null;
        try {
          pause();
        } catch {
          // Audio failure must not prevent studying.
        }
        onError(error);
      }
    },
    dispose() {
      disposed = true;
      revision++;
      try {
        pause();
        subscription?.remove();
        player?.remove();
      } catch (error) {
        onError(error);
      } finally {
        subscription = null;
        player = null;
      }
    },
  };
}
