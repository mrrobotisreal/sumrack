import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { ListenSource } from '@/db/repositories/listen';
import { claim as claimAudio, registerOwner } from '@/features/audio/arbiter';

import { partAt } from './part-at';
import { LISTEN_PREFS_DEFAULTS, toListenRate, type ListenPrefs, type ListenRate } from './prefs';
import {
  EMPTY_PROGRESS,
  clearFinished,
  markFinished,
  markProgress,
  resumePositionFor,
  type ListenProgress,
} from './progress';

/**
 * The global listen player (FULL_STORY_LISTEN §5.1, T96). Pure of expo imports:
 * every native/IO dependency arrives through `ListenDeps`, so the vitest suite
 * drives it with a fake player, clock and repos. `listen-service.ts` wires the
 * module singleton with the real expo-audio player.
 */

export const AUTOSAVE_MS = 10_000;
export const SKIP_BACK_MS = 15_000;
export const SKIP_FORWARD_MS = 30_000;

export type OpenSource = 'library' | 'now-playing' | 'resume';
export type SeekMethod = 'scrub' | 'back15' | 'forward30' | 'part' | 'lockscreen';
export type StopReason = 'user' | 'replaced' | 'error' | 'reader';

/** The slice of expo-audio's AudioPlayer the service uses (a fake in tests). */
export interface ListenPlayerLike {
  readonly currentTime: number;
  readonly playing: boolean;
  volume: number;
  muted: boolean;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  replace(source: { uri: string }): void;
  remove(): void;
  setPlaybackRate(rate: number, quality?: 'low' | 'medium' | 'high'): void;
  setActiveForLockScreen(
    active: boolean,
    metadata?: { title?: string; artist?: string; albumTitle?: string; artworkUrl?: string },
    options?: { showSeekForward?: boolean; showSeekBackward?: boolean },
  ): void;
  updateLockScreenMetadata(metadata: {
    title?: string;
    artist?: string;
    albumTitle?: string;
    artworkUrl?: string;
  }): void;
  clearLockScreenControls(): void;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: ListenStatus) => void,
  ): { remove(): void } | void;
}

export interface ListenStatus {
  playing: boolean;
  didJustFinish: boolean;
  error: string | null;
  /** Seconds. */
  duration: number;
}

export interface ListenDeps {
  createPlayer(uri: string): ListenPlayerLike;
  setAudioMode(): Promise<void>;
  getSource(packId: string): Promise<ListenSource | null>;
  loadProgress(): Promise<ListenProgress>;
  saveProgress(p: ListenProgress): Promise<void>;
  loadPrefs(): Promise<ListenPrefs>;
  savePrefs(p: ListenPrefs): Promise<void>;
  /** file:// uri for the lock-screen artwork when the pack has no cover. */
  getFallbackArtwork(): Promise<string | undefined>;
  track(event: string, props: Record<string, string | number | boolean>): void;
  now(): number;
}

export interface ListenSession {
  source: ListenSource;
  status: 'loading' | 'ready' | 'error';
}

export interface ListenState {
  session: ListenSession | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: ListenRate;
  volume: number;
  muted: boolean;
  partIndex: number;
  finished: boolean;
  error?: string;
}

const INITIAL: ListenState = {
  session: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  rate: LISTEN_PREFS_DEFAULTS.rate,
  volume: LISTEN_PREFS_DEFAULTS.volume,
  muted: LISTEN_PREFS_DEFAULTS.muted,
  partIndex: 0,
  finished: false,
};

export interface ListenPlayer {
  store: UseBoundStore<StoreApi<ListenState>>;
  open(packId: string, opts?: { autoplay?: boolean; source?: OpenSource }): Promise<void>;
  play(): void;
  pause(): void;
  toggle(): void;
  seekTo(ms: number, method?: SeekMethod): Promise<void>;
  skip(deltaMs: number): Promise<void>;
  seekToPart(index: number): Promise<void>;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Pause for the reader hand-off. */
  pauseForReader(): void;
  /** Analytics passthrough for screen-level events (listen_open_reader). */
  track(event: string, props: Record<string, string | number | boolean>): void;
  /** Persist the position now (pause/background/unmount). */
  saveNow(): void;
  onBackground(): void;
  stop(reason?: StopReason): void;
}

export function createListenPlayer(deps: ListenDeps): ListenPlayer {
  const store = create<ListenState>(() => ({ ...INITIAL }));
  const get = store.getState;
  const set = store.setState;

  let player: ListenPlayerLike | null = null;
  let listenerSub: { remove(): void } | void = undefined;
  let progress: ListenProgress | null = null;
  let prefs: ListenPrefs | null = null;
  let artwork: string | undefined;
  let audioModeSet = false;
  let lockScreenActive = false;
  let autosaveTimer: ReturnType<typeof setInterval> | null = null;
  let openToken = 0;
  let reachedParts = new Set<number>();
  let listenedMs = 0;
  let lastPosMs = 0;

  const props = () => {
    const s = get();
    return { packId: s.session?.source.packId ?? '' };
  };

  async function ensureProgress(): Promise<ListenProgress> {
    if (!progress) progress = (await deps.loadProgress()) ?? EMPTY_PROGRESS;
    return progress;
  }
  async function ensurePrefs(): Promise<ListenPrefs> {
    if (!prefs) prefs = (await deps.loadPrefs()) ?? LISTEN_PREFS_DEFAULTS;
    return prefs;
  }
  function writeProgress(next: ListenProgress) {
    progress = next;
    void deps.saveProgress(next);
  }

  function readPositionMs(): number {
    return player ? Math.round(player.currentTime * 1000) : get().positionMs;
  }

  function persistPosition() {
    const s = get();
    if (!s.session || s.session.status !== 'ready' || s.finished || !progress) return;
    const pos = readPositionMs();
    writeProgress(markProgress(progress, s.session.source.packId, pos, s.durationMs, deps.now()));
  }

  function stopTimer() {
    if (autosaveTimer) clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
  function startTimer() {
    if (autosaveTimer) return;
    autosaveTimer = setInterval(persistPosition, AUTOSAVE_MS);
  }

  function lockMeta(source: ListenSource, partIndex: number) {
    const seg = source.segments[partIndex];
    return {
      title: source.titleRu,
      artist: `Часть ${partIndex + 1}${seg ? ` · ${seg.titleRu}` : ''}`,
      albumTitle: 'Сумрак',
      artworkUrl: source.coverUri ?? artwork,
    };
  }

  function applyLockScreen() {
    const s = get();
    if (!player || !s.session) return;
    player.setActiveForLockScreen(true, lockMeta(s.session.source, s.partIndex), {
      showSeekForward: true,
      showSeekBackward: true,
    });
    lockScreenActive = true;
  }

  function onStatus(status: ListenStatus) {
    const s = get();
    if (!player || !s.session || s.session.status === 'loading') return;
    if (status.error) {
      set({ playing: false, error: status.error, session: { ...s.session, status: 'error' } });
      return;
    }
    if (status.didJustFinish) {
      const dur = s.durationMs;
      // Park the player back at 0 immediately: ExoPlayer's ENDED state is
      // race-prone (play() at the end can re-emit didJustFinish before a
      // rewind lands — hit on the S24 Ultra). Pause first — a seek from
      // ENDED auto-resumes while playWhenReady is still set (seen on the
      // emulator). UI keeps showing the full duration.
      player.pause();
      void player.seekTo(0);
      stopTimer();
      set({ playing: false, finished: true, positionMs: 0, partIndex: 0 });
      writeProgress(
        markFinished(progress ?? EMPTY_PROGRESS, s.session.source.packId, dur, deps.now()),
      );
      deps.track('listen_finished', {
        ...props(),
        durationMs: dur,
        listenedMs: Math.round(listenedMs),
        rate: s.rate,
      });
      return;
    }
    const pos = readPositionMs();
    if (status.playing) {
      const delta = pos - lastPosMs;
      if (delta > 0 && delta < 3000 * Math.max(1, s.rate)) listenedMs += delta;
    }
    lastPosMs = pos;
    const idx = partAt(s.session.source.segments, pos);
    const patch: Partial<ListenState> = { playing: status.playing, positionMs: pos };
    if (idx !== s.partIndex) {
      patch.partIndex = idx;
      if (lockScreenActive) player.updateLockScreenMetadata(lockMeta(s.session.source, idx));
    }
    if (status.playing && !reachedParts.has(idx)) {
      reachedParts.add(idx);
      deps.track('listen_part_reached', {
        ...props(),
        storyId: s.session.source.segments[idx]?.storyId ?? '',
        partIndex: idx,
      });
    }
    if (status.playing) startTimer();
    else stopTimer();
    set(patch);
  }

  function teardownPlayer() {
    stopTimer();
    if (player) {
      listenerSub?.remove();
      listenerSub = undefined;
      if (lockScreenActive) player.clearLockScreenControls();
      player.remove();
    }
    player = null;
    lockScreenActive = false;
  }

  const api: ListenPlayer = {
    store,

    async open(packId, opts = {}) {
      const { autoplay = false, source: from = 'library' } = opts;
      const cur = get();
      if (cur.session?.source.packId === packId && cur.session.status === 'ready') {
        if (autoplay && !cur.playing) api.play();
        return;
      }
      const token = ++openToken;
      // Replacing another pack: save its position first.
      if (cur.session && cur.session.source.packId !== packId && cur.session.status === 'ready') {
        persistPosition();
        deps.track('listen_stopped', {
          ...props(),
          positionMs: readPositionMs(),
          reason: 'replaced',
        });
        player?.pause();
      }
      const source = await deps.getSource(packId);
      if (token !== openToken) return;
      if (!source) {
        set({
          ...INITIAL,
          rate: get().rate,
          volume: get().volume,
          muted: get().muted,
          error: 'Не удалось открыть аудио',
        });
        return;
      }
      set({
        session: { source, status: 'loading' },
        playing: false,
        positionMs: 0,
        durationMs: source.durationMs,
        partIndex: 0,
        finished: false,
        error: undefined,
      });
      const [prog, pr] = await Promise.all([ensureProgress(), ensurePrefs()]);
      if (!source.coverUri && artwork === undefined) {
        artwork = (await deps.getFallbackArtwork().catch(() => undefined)) ?? undefined;
      }
      if (token !== openToken) return;
      if (!source.uri) {
        set({ session: { source, status: 'error' }, error: 'Не удалось открыть аудио' });
        return;
      }
      const resumeMs = resumePositionFor(prog, packId);
      const wasFinished = prog.byPack[packId]?.finishedAt != null;
      try {
        if (player) {
          player.replace({ uri: source.uri });
        } else {
          player = deps.createPlayer(source.uri);
          listenerSub = player.addListener('playbackStatusUpdate', onStatus);
        }
        player.setPlaybackRate(pr.rate, 'high');
        player.volume = pr.volume;
        player.muted = pr.muted;
        if (resumeMs > 0) await player.seekTo(resumeMs / 1000);
        else if (wasFinished) await player.seekTo(0);
      } catch (e) {
        if (token !== openToken) return;
        set({
          session: { source, status: 'error' },
          error: e instanceof Error ? e.message : 'Не удалось открыть аудио',
        });
        return;
      }
      if (token !== openToken) return;
      reachedParts = new Set();
      listenedMs = 0;
      lastPosMs = resumeMs;
      set({
        session: { source, status: 'ready' },
        rate: pr.rate,
        volume: pr.volume,
        muted: pr.muted,
        positionMs: resumeMs,
        partIndex: partAt(source.segments, resumeMs),
        finished: wasFinished,
        error: undefined,
      });
      deps.track('listen_opened', {
        packId,
        kind: source.kind,
        parts: source.segments.length,
        durationMs: source.durationMs,
        resumedFromMs: resumeMs,
        source: from,
      });
      if (autoplay) api.play();
    },

    play() {
      const s = get();
      if (!player || !s.session || s.session.status !== 'ready') return;
      claimAudio('listen');
      if (!audioModeSet) {
        audioModeSet = true;
        void deps.setAudioMode();
      }
      if (s.finished && progress) {
        writeProgress(clearFinished(progress, s.session.source.packId));
      }
      applyLockScreen();
      player.play();
      set({ playing: true, finished: false });
      startTimer();
      deps.track('listen_play', {
        ...props(),
        positionMs: readPositionMs(),
        partIndex: s.partIndex,
      });
    },

    pause() {
      const s = get();
      if (!player || !s.session || !player.playing) return;
      player.pause();
      stopTimer();
      set({ playing: false, positionMs: readPositionMs() });
      persistPosition();
      deps.track('listen_pause', {
        ...props(),
        positionMs: readPositionMs(),
        partIndex: s.partIndex,
      });
    },

    toggle() {
      if (get().playing) api.pause();
      else api.play();
    },

    async seekTo(ms, method = 'scrub') {
      const s = get();
      if (!player || !s.session || s.session.status !== 'ready') return;
      const to = Math.min(Math.max(0, Math.round(ms)), s.durationMs);
      const from = readPositionMs();
      deps.track('listen_seek', { ...props(), method, fromMs: from, toMs: to });
      lastPosMs = to;
      await player.seekTo(to / 1000);
      const idx = partAt(s.session.source.segments, to);
      set({ positionMs: to, partIndex: idx, finished: false });
      if (idx !== s.partIndex && lockScreenActive) {
        player.updateLockScreenMetadata(lockMeta(s.session.source, idx));
      }
      persistPosition();
    },

    async skip(deltaMs) {
      await api.seekTo(readPositionMs() + deltaMs, deltaMs < 0 ? 'back15' : 'forward30');
    },

    async seekToPart(index) {
      const seg = get().session?.source.segments[index];
      if (!seg) return;
      await api.seekTo(seg.startMs, 'part');
    },

    setRate(rate) {
      const r = toListenRate(rate);
      if (r === null) return;
      player?.setPlaybackRate(r, 'high');
      set({ rate: r });
      prefs = { ...(prefs ?? LISTEN_PREFS_DEFAULTS), rate: r };
      void deps.savePrefs(prefs);
      deps.track('listen_rate_changed', { ...props(), rate: r });
    },

    setVolume(volume) {
      const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
      if (player) player.volume = v;
      set({ volume: v });
      prefs = { ...(prefs ?? LISTEN_PREFS_DEFAULTS), volume: v };
      void deps.savePrefs(prefs);
      deps.track('listen_volume_changed', { ...props(), volume: v, muted: get().muted });
    },

    setMuted(muted) {
      if (player) player.muted = muted;
      set({ muted });
      prefs = { ...(prefs ?? LISTEN_PREFS_DEFAULTS), muted };
      void deps.savePrefs(prefs);
      deps.track('listen_volume_changed', { ...props(), volume: get().volume, muted });
    },

    track(event, p) {
      deps.track(event, p);
    },

    pauseForReader() {
      api.pause();
    },

    saveNow() {
      persistPosition();
    },

    onBackground() {
      const s = get();
      if (!s.session) return;
      persistPosition();
      if (s.playing) deps.track('listen_background', props());
    },

    stop(reason = 'user') {
      const s = get();
      if (!s.session) return;
      openToken++;
      if (s.session.status === 'ready') {
        persistPosition();
        deps.track('listen_stopped', { ...props(), positionMs: readPositionMs(), reason });
      }
      player?.pause();
      teardownPlayer();
      set({ ...INITIAL, rate: s.rate, volume: s.volume, muted: s.muted });
    },
  };

  // The arbiter pauses us when reader narration claims the audio.
  registerOwner('listen', () => {
    if (get().playing) {
      api.pause();
    }
  });

  return api;
}
