import { disposePlayer } from '@/features/audio/dispose-player';

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
  /** SharedObject.release(): frees the native player now (ISS-005). */
  release(): void;
  /** Swap the source on the same native player (keeps the audio session). Beds = asset ids, scores = file uris (T115). */
  replace(source: AmbientSource): void;
  seekTo(seconds: number): Promise<void>;
  /** T115: a score follows the narration's speed (pitch-corrected); beds always run at 1. */
  setPlaybackRate(rate: number, quality?: 'low' | 'medium' | 'high'): void;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: AmbientStatus) => void,
  ): {
    remove(): void;
  };
}

/** A bundled bed (`require()` asset id) or a staged score file (T115). */
export type AmbientSource = number | { uri: string };

/**
 * T115 (AMBIENT_SOUNDTRACKS §11): a part's composed score to play on the one
 * ambient player, synced to the narration that owns it.
 */
export interface ScoreTarget {
  /** `<packId>/<storyId>/<trackId>` — a change means a new score file. */
  key: string;
  uri: string;
  durationMs: number;
  /** The narration position in the score's time (ms), read live. */
  positionMs(): number;
  /** The narration's playback rate. */
  rate: number;
  /** Bumped by every user seek of the narration: forces an immediate re-seek. */
  seekRevision: number;
  /** Ids only — spread onto every score event. */
  props: { packId: string; storyId: string; mode: 'reader' | 'listen' };
}

/** The status fields the engine reads (expo-audio `AudioStatus` is a superset). */
export interface AmbientStatus {
  didJustFinish: boolean;
  playing: boolean;
  currentTime: number;
}

export type AmbientEngineEvent =
  | 'ambient_theme_started'
  | 'ambient_theme_switched'
  | 'ambient_bed_advanced'
  | 'score_started'
  | 'score_paused'
  | 'score_resynced';

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
/** T115: while a score plays, its drift from the narration is checked this often… */
export const SCORE_DRIFT_CHECK_MS = 2000;
/** …and re-seeked when it is off by more than this. */
export const SCORE_MAX_DRIFT_MS = 150;
/** A narration position this close to the score's end = past the score (silence). */
export const SCORE_END_GUARD_MS = 50;

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
  createPlayer: (source: AmbientSource) => AmbientPlayer,
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
  /** T115: the score the player holds (null = a bed, or nothing yet). */
  let currentScore: ScoreTarget | null = null;
  /** The score is audibly playing (drives score_started / score_paused). */
  let scorePlaying = false;
  /** The loaded score reached its end (ExoPlayer ENDED): re-seek before playing. */
  let scoreEnded = false;
  let driftTimer: ReturnType<typeof setInterval> | null = null;
  let lastSeekRevision = -1;

  function saveCursorNow() {
    if (!player || !currentTheme || !currentBed) return;
    const positionMs = Math.max(0, Math.round((player.currentTime || 0) * 1000));
    deps.saveCursor(currentTheme, { bed: currentBed.slug, positionMs });
    lastSaveAt = now();
  }

  function stopDriftTimer() {
    if (driftTimer) clearInterval(driftTimer);
    driftTimer = null;
  }

  function pause() {
    wantPlaying = false;
    stopDriftTimer();
    if (!player) return;
    // Synchronous: a backgrounded app suspends JS timers, so no fade here.
    player.volume = 0;
    player.pause();
    saveCursorNow();
    if (currentScore && scorePlaying) {
      scorePlaying = false;
      deps.onEvent('score_paused', {
        ...currentScore.props,
        positionMs: Math.max(0, Math.round((player.currentTime || 0) * 1000)),
      });
    }
  }

  /**
   * T115 drift check: re-seek the score onto the narration clock when it is off
   * by > SCORE_MAX_DRIFT_MS; past the score's end, park it (silence until the
   * part changes or the narration seeks back).
   */
  function checkDrift() {
    const score = currentScore;
    if (disposed || !player || !score || !wantPlaying) return;
    const target = score.positionMs();
    if (target >= score.durationMs - SCORE_END_GUARD_MS) {
      if (!scoreEnded) {
        scoreEnded = true;
        player.pause();
      }
      return;
    }
    if (scoreEnded) {
      scoreEnded = false;
      void player.seekTo(target / 1000).then(() => {
        if (!disposed && wantPlaying && currentScore === score) player?.play();
      });
      return;
    }
    const drift = Math.round((player.currentTime || 0) * 1000) - target;
    if (Math.abs(drift) > SCORE_MAX_DRIFT_MS) {
      void player.seekTo(target / 1000);
      deps.onEvent('score_resynced', { ...score.props, driftMs: drift });
    }
  }

  /** Leave score mode before a bed loads: the bed always runs at 1×. */
  function leaveScoreMode() {
    if (!currentScore) return;
    stopDriftTimer();
    currentScore = null;
    scorePlaying = false;
    scoreEnded = false;
    try {
      player?.setPlaybackRate(1, 'high');
    } catch {
      // A rate reset failure must not block the bed.
    }
  }

  async function updateScore(active: boolean, volume: number, score: ScoreTarget, current: number) {
    if (!active || volume <= 0) {
      // The bed does not come back mid-part: a paused narration = a paused score.
      pause();
      return;
    }
    preparation ??= prepare();
    await preparation;
    if (disposed || revision !== current) return;

    const fresh = !currentScore || currentScore.key !== score.key;
    if (fresh) {
      // Entering score mode (or the next part): the bed's cursor is saved as
      // now, the bed fades out on the same player, the score file swaps in.
      if (player && currentTheme) {
        saveCursorNow();
        if (!(await fadeTo(0, current))) return;
      }
      if (player) player.replace({ uri: score.uri });
      else {
        player = createPlayer({ uri: score.uri });
        subscription = player.addListener('playbackStatusUpdate', onStatus);
      }
      currentTheme = null;
      currentBed = null;
      advancing = false;
      scorePlaying = false;
      scoreEnded = false;
      player.loop = false;
      player.volume = 0;
    }
    currentScore = score;
    player!.setPlaybackRate(score.rate, 'high');
    const target = score.positionMs();
    wantPlaying = true;
    if (target >= score.durationMs - SCORE_END_GUARD_MS) {
      // Narration sits past the score (the listen gap): silence.
      scoreEnded = true;
      player!.pause();
    } else {
      // Seek on load / resume / user seek / real drift only — a volume or rate
      // change on a score already in sync must not hiccup.
      const drift = Math.round((player!.currentTime || 0) * 1000) - target;
      const needSeek =
        fresh ||
        !scorePlaying ||
        scoreEnded ||
        score.seekRevision !== lastSeekRevision ||
        Math.abs(drift) > SCORE_MAX_DRIFT_MS;
      lastSeekRevision = score.seekRevision;
      if (needSeek) {
        await player!.seekTo(Math.max(0, target) / 1000);
        if (disposed || revision !== current || !player) return;
      }
      scoreEnded = false;
      player!.volume = volume;
      player!.play();
      if (!scorePlaying) {
        scorePlaying = true;
        deps.onEvent('score_started', { ...score.props, positionMs: Math.max(0, target) });
      }
    }
    if (!driftTimer) driftTimer = setInterval(checkDrift, SCORE_DRIFT_CHECK_MS);
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
      if (currentScore) {
        // A score never advances or loops: park it (ENDED race, use-narration.ts).
        scoreEnded = true;
        player.pause();
        return;
      }
      advance();
      return;
    }
    if (currentScore) return;
    if (!status.playing) return;
    advancing = false;
    if (now() - lastSaveAt >= CURSOR_SAVE_INTERVAL_MS) saveCursorNow();
  }

  return {
    /**
     * `score` given = T115 score mode: `active` means "the narration plays and
     * the policy allows the score"; otherwise the bed rotation for `theme`.
     */
    async update(active: boolean, volume: number, theme: AmbientThemeId, score?: ScoreTarget) {
      const current = ++revision;
      if (disposed) return;
      try {
        if (score) {
          await updateScore(active, volume, score, current);
          return;
        }
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
        leaveScoreMode();
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
    /**
     * «Reset rotation» (T49): if `theme` is the loaded one, swap to its
     * `nextStart` (bed 1 @ 0 after the cursor was cleared) on the same player,
     * keeping the play/pause intent. Other themes need nothing — their next
     * start reads the cursor anyway.
     */
    restart(theme: AmbientThemeId) {
      if (disposed || !player || currentTheme !== theme) return;
      const start = nextStart(theme, deps.getCursor(theme));
      try {
        player.replace(start.bed.source);
        currentBed = start.bed;
        advancing = false;
        if (start.positionMs > 0) void player.seekTo(start.positionMs / 1000);
        if (wantPlaying) player.play();
        lastSaveAt = now();
      } catch (error) {
        onError(error);
      }
    },
    dispose() {
      disposed = true;
      revision++;
      try {
        // Saves the cursor and reports score_paused while the player is alive.
        pause();
      } catch (error) {
        onError(error);
      }
      stopDriftTimer();
      // ISS-005: pause → unsubscribe → remove → release (remove alone leaks it).
      disposePlayer(player, { subscriptions: [subscription], onError: (_s, e) => onError(e) });
      subscription = null;
      player = null;
    },
  };
}
