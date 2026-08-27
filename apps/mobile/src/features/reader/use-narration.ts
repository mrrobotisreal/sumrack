import { useQuery } from '@tanstack/react-query';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as React from 'react';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import type { AudioTrackRow } from '@/db/repositories/content';
import { track as trackEvent } from '@/services/analytics';

import {
  activeSentenceAt,
  activeWordAt,
  buildKaraokeIndex,
  mapPositionAcrossTracks,
  seekTargetForSentence,
  tokenKey,
  type ActiveWord,
  type KaraokeIndex,
  type KaraokeSentenceInput,
} from './karaoke';

/**
 * Narration playback controller (T10, design §7.1) — owns the expo-audio
 * player for the reader screen, the karaoke clock, track switching, speed,
 * lockscreen/media-session state, and word-segment playback for the popup.
 *
 * Position is read from the player on a short JS interval while playing
 * (`player.currentTime` is a cheap shared-object property read); the active
 * word/sentence states only change when the computed value changes, so the
 * screen re-renders at word cadence, not tick cadence. Lockscreen transport
 * controls mutate the player natively — the status listener + the same tick
 * keep the JS state in sync afterward.
 */

/** Speed steps per design §7.1 (0.7×–1.25×). */
export const NARRATION_RATES = [0.7, 0.85, 1, 1.1, 1.25] as const;

const TICK_MS = 120;
/** Scrub-bar position state granularity (keeps re-renders ~4/s while playing). */
const POSITION_STATE_GRANULARITY_MS = 250;

interface NarrationPrefs {
  rate: number;
}

/** New-setting validation per roadmap DoD (same pattern as reader-prefs). */
function sanitizePrefs(raw: unknown): NarrationPrefs {
  const rate =
    raw != null && typeof raw === 'object' && typeof (raw as { rate?: unknown }).rate === 'number'
      ? (raw as { rate: number }).rate
      : 1;
  const valid = NARRATION_RATES.find((r) => Math.abs(r - rate) < 0.001);
  return { rate: valid ?? 1 };
}

export type SeekMethod = 'scrub' | 'sentence' | 'auto';

export interface WordSegmentPlayer {
  hasSegment(sentenceId: string, tokenIndex: number): boolean;
  /** Play just this word's slice of the current track (pauses narration). */
  playSegment(sentenceId: string, tokenIndex: number): void;
}

export interface Narration {
  /** True when the story has at least one downloaded (playable) track. */
  available: boolean;
  playableTracks: AudioTrackRow[];
  currentTrack: AudioTrackRow | null;
  /** null until the stamps query settles for the current track. */
  mode: 'word' | 'sentence' | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  /** Player-reported unrecoverable error for the current source, if any. */
  error: string | null;
  activeWord: ActiveWord | null;
  /** Reader list index of the sentence to keep in view (null = none). */
  activeSentenceIdx: number | null;
  activeSentenceId: string | null;
  toggle(): void;
  /**
   * Epoch ms of the last user-initiated seek (scrub or sentence tap;
   * 'auto' seeks excluded). The reader uses this to keep the auto-follow
   * jump after an explicit seek from writing the reading position (T30.2 /
   * CT003b: a stray seek must not count as reading progress).
   */
  lastUserSeekAtRef: Readonly<React.MutableRefObject<number>>;
  seekToMs(ms: number, method: SeekMethod): void;
  seekToSentence(sentenceId: string): void;
  cycleRate(): void;
  switchTrack(trackId: string): void;
  segments: WordSegmentPlayer;
}

interface UseNarrationArgs {
  packId: string;
  storyId: string;
  /** Lockscreen metadata (design §7.1 — listen like a podcast). */
  storyTitleRu: string;
  packTitleRu: string;
  sentences: readonly KaraokeSentenceInput[];
  tracks: readonly AudioTrackRow[];
}

/** "elevenlabs:Elen Kuragina" + "creepy-whisper" → "Elen Kuragina · creepy whisper". */
export function trackLabel(track: Pick<AudioTrackRow, 'voice' | 'style'>): string {
  const voice = track.voice.replace(/^[^:]+:/, '');
  const style = track.style.replace(/-/g, ' ');
  return `${voice} · ${style}`;
}

export function useNarration({
  packId,
  storyId,
  storyTitleRu,
  packTitleRu,
  sentences,
  tracks,
}: UseNarrationArgs): Narration {
  const playableTracks = React.useMemo(() => tracks.filter((t) => t.localUri != null), [tracks]);

  const [trackId, setTrackId] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [positionMs, setPositionMs] = React.useState(0);
  const [rate, setRate] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [activeWord, setActiveWord] = React.useState<ActiveWord | null>(null);
  const [activeSentence, setActiveSentence] = React.useState<{
    id: string;
    idx: number;
  } | null>(null);
  // See Narration.lastUserSeekAtRef — 0 = no user seek yet this mount.
  const lastUserSeekAtRef = React.useRef(0);

  // Selection state only records explicit user switches; before the first
  // switch the first playable track is the derived default.
  const effectiveTrackId = trackId ?? playableTracks[0]?.id ?? null;
  const currentTrack = React.useMemo(
    () => playableTracks.find((t) => t.id === effectiveTrackId) ?? null,
    [playableTracks, effectiveTrackId],
  );

  // ---- karaoke index for the current track --------------------------------
  const stampsQuery = useQuery({
    queryKey: ['word-stamps', packId, storyId, effectiveTrackId ?? ''],
    queryFn: () => repos.content.getWordStamps(packId, storyId, effectiveTrackId!),
    enabled: effectiveTrackId != null,
  });

  const index: KaraokeIndex | null = React.useMemo(() => {
    if (!currentTrack || !stampsQuery.data) return null;
    return buildKaraokeIndex(sentences, stampsQuery.data, currentTrack.durationMs);
  }, [currentTrack, stampsQuery.data, sentences]);

  const indexRef = React.useRef<KaraokeIndex | null>(null);
  React.useEffect(() => {
    indexRef.current = index;
  }, [index]);

  React.useEffect(() => {
    if (!index || !currentTrack) return;
    trackEvent('narration_track_loaded', {
      packId,
      storyId,
      trackId: currentTrack.id,
      mode: index.mode,
      stamps: index.stamps.length,
    });
    if (index.mode === 'sentence') {
      // The §11 degradation path actually engaged — worth seeing in analytics.
      trackEvent('karaoke_fallback_sentence_mode', { packId, storyId, trackId: currentTrack.id });
    }
  }, [index, currentTrack, packId, storyId]);

  // ---- player lifecycle ---------------------------------------------------
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const segmentPlayerRef = React.useRef<AudioPlayer | null>(null);
  const segmentTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateRef = React.useRef(1);
  const lockScreenActiveRef = React.useRef(false);

  // Background playback + exclusive focus (must be set before first play;
  // Android keeps a media notification alive via setActiveForLockScreen).
  React.useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: true,
    });
  }, []);

  // Persisted speed preference (validated on read).
  React.useEffect(() => {
    let cancelled = false;
    void repos.settings.get(SETTING_KEYS.narrationPrefs).then((raw) => {
      if (cancelled) return;
      const prefs = sanitizePrefs(raw);
      rateRef.current = prefs.rate;
      setRate(prefs.rate);
      playerRef.current?.setPlaybackRate(prefs.rate, 'high');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLockScreen = React.useCallback(
    (player: AudioPlayer, trackRow: AudioTrackRow) => {
      player.setActiveForLockScreen(
        true,
        { title: storyTitleRu, artist: trackLabel(trackRow), albumTitle: packTitleRu },
        { showSeekForward: true, showSeekBackward: true },
      );
      lockScreenActiveRef.current = true;
    },
    [storyTitleRu, packTitleRu],
  );

  /** Create the player on first use; swap sources afterward. */
  const ensurePlayer = React.useCallback((uri: string): AudioPlayer => {
    if (playerRef.current) {
      playerRef.current.replace({ uri });
      return playerRef.current;
    }
    const player = createAudioPlayer({ uri }, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', (status) => {
      setPlaying(status.playing);
      setError(status.error);
      if (status.didJustFinish) {
        setPlaying(false);
        setActiveWord(null);
        setActiveSentence(null);
        setPositionMs(Math.round(status.duration * 1000));
        trackEvent('narration_finished', {});
        // Park the player back at 0 immediately: ExoPlayer's ENDED state is
        // race-prone (play() at the end can re-emit didJustFinish before a
        // rewind lands — hit on the S24 Ultra). Pause first — a seek from
        // ENDED auto-resumes while playWhenReady is still set (seen on the
        // emulator). UI keeps showing the full duration.
        player.pause();
        void player.seekTo(0);
      }
    });
    playerRef.current = player;
    return player;
  }, []);

  // Load the source whenever the effective track changes. Track *switches*
  // (not first load) carry the reading position over via the karaoke maps.
  const prevTrackRef = React.useRef<{ track: AudioTrackRow; index: KaraokeIndex | null } | null>(
    null,
  );
  const pendingSwitchRef = React.useRef<{
    fromMs: number;
    fromIndex: KaraokeIndex | null;
    fromDurationMs: number;
    wasPlaying: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (!currentTrack?.localUri) return;
    const prev = prevTrackRef.current;
    if (prev?.track.id === currentTrack.id) return;
    const player = ensurePlayer(currentTrack.localUri);
    player.setPlaybackRate(rateRef.current, 'high');
    setPositionMs(0);
    setActiveWord(null);
    setActiveSentence(null);
    if (prev) {
      // Mid-story voice switch: remember where we were; the seek happens
      // once the new track's stamps are in (effect below).
      trackEvent('narration_track_switched', {
        packId,
        storyId,
        from: prev.track.id,
        to: currentTrack.id,
      });
    }
    prevTrackRef.current = { track: currentTrack, index: null };
    if (lockScreenActiveRef.current) applyLockScreen(player, currentTrack);
  }, [currentTrack, ensurePlayer, applyLockScreen, packId, storyId]);

  // Keep the latest index attached to the current-track record (used as the
  // switch source next time), and resolve a pending cross-track seek.
  React.useEffect(() => {
    if (!index || !currentTrack) return;
    if (prevTrackRef.current?.track.id === currentTrack.id) {
      prevTrackRef.current.index = index;
    }
    const pending = pendingSwitchRef.current;
    if (!pending) return;
    pendingSwitchRef.current = null;
    const from =
      pending.fromIndex ??
      // Stampless source track: proportional mapping via a bare index.
      buildKaraokeIndex([], [], pending.fromDurationMs);
    const targetMs = mapPositionAcrossTracks(from, index, pending.fromMs);
    const player = playerRef.current;
    if (!player) return;
    void player.seekTo(targetMs / 1000).then(() => {
      setPositionMs(targetMs);
      if (pending.wasPlaying) player.play();
    });
  }, [index, currentTrack]);

  // ---- the karaoke clock --------------------------------------------------
  const lastShownPositionRef = React.useRef(0);

  const syncFromPosition = React.useCallback((posMs: number, force = false) => {
    const idx = indexRef.current;
    if (force || Math.abs(posMs - lastShownPositionRef.current) >= POSITION_STATE_GRANULARITY_MS) {
      lastShownPositionRef.current = posMs;
      setPositionMs(posMs);
    }
    if (!idx) return;
    const word = activeWordAt(idx, posMs);
    setActiveWord((prev) =>
      prev?.sentenceId === word?.sentenceId && prev?.tokenIndex === word?.tokenIndex ? prev : word,
    );
    const span = activeSentenceAt(idx, posMs);
    setActiveSentence((prev) =>
      prev?.id === span?.sentenceId
        ? prev
        : span
          ? { id: span.sentenceId, idx: span.sentenceIdx }
          : null,
    );
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      // The native `playing` guard kills the one stale tick that can land
      // after didJustFinish cleared the highlight (verified on-device).
      if (!player || !player.playing) return;
      syncFromPosition(Math.round(player.currentTime * 1000));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, syncFromPosition]);

  // ---- controls -----------------------------------------------------------
  const toggle = React.useCallback(() => {
    const player = playerRef.current;
    if (!player || !currentTrack) return;
    if (player.playing) {
      player.pause();
      trackEvent('narration_pause', { packId, storyId, trackId: currentTrack.id });
    } else {
      applyLockScreen(player, currentTrack);
      // Play after the track ended = listen again from the top.
      const atEnd = Math.round(player.currentTime * 1000) >= currentTrack.durationMs - 250;
      if (atEnd) {
        void player.seekTo(0).then(() => {
          syncFromPosition(0, true);
          player.play();
        });
      } else {
        player.play();
      }
      trackEvent('narration_play', { packId, storyId, trackId: currentTrack.id });
    }
  }, [currentTrack, applyLockScreen, packId, storyId, syncFromPosition]);

  const seekToMs = React.useCallback(
    (ms: number, method: SeekMethod) => {
      const player = playerRef.current;
      if (!player || !currentTrack) return;
      const clamped = Math.min(Math.max(0, ms), currentTrack.durationMs);
      void player.seekTo(clamped / 1000).then(() => syncFromPosition(clamped, true));
      if (method !== 'auto') {
        lastUserSeekAtRef.current = Date.now();
        trackEvent('narration_seek', { packId, storyId, method, toMs: clamped });
      }
    },
    [currentTrack, syncFromPosition, packId, storyId],
  );

  const seekToSentence = React.useCallback(
    (sentenceId: string) => {
      const idx = indexRef.current;
      if (!idx) return;
      const target = seekTargetForSentence(idx, sentenceId);
      if (target == null) return;
      seekToMs(target, 'sentence');
    },
    [seekToMs],
  );

  const cycleRate = React.useCallback(() => {
    const current = rateRef.current;
    const i = NARRATION_RATES.findIndex((r) => Math.abs(r - current) < 0.001);
    const next = NARRATION_RATES[(i + 1) % NARRATION_RATES.length]!;
    rateRef.current = next;
    setRate(next);
    playerRef.current?.setPlaybackRate(next, 'high');
    void repos.settings.set(SETTING_KEYS.narrationPrefs, { rate: next });
    trackEvent('narration_rate_changed', { rate: next });
  }, []);

  const switchTrack = React.useCallback(
    (nextId: string) => {
      if (nextId === effectiveTrackId) return;
      const player = playerRef.current;
      const prev = prevTrackRef.current;
      if (player && prev) {
        pendingSwitchRef.current = {
          fromMs: Math.round(player.currentTime * 1000),
          fromIndex: prev.index,
          fromDurationMs: prev.track.durationMs,
          wasPlaying: player.playing,
        };
        player.pause();
      }
      setTrackId(nextId);
    },
    [effectiveTrackId],
  );

  // ---- word segments (popup speaker, work item 7) -------------------------
  const stopSegment = React.useCallback(() => {
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    segmentPlayerRef.current?.pause();
  }, []);

  const segments = React.useMemo<WordSegmentPlayer>(
    () => ({
      hasSegment: (sentenceId, tokenIndex) =>
        indexRef.current?.stampByToken.has(tokenKey(sentenceId, tokenIndex)) ?? false,
      playSegment: (sentenceId, tokenIndex) => {
        const idx = indexRef.current;
        const uri = currentTrack?.localUri;
        if (!idx || !uri) return;
        const stamp = idx.stampByToken.get(tokenKey(sentenceId, tokenIndex));
        if (!stamp) return;
        // Never fight the narration for the same word.
        playerRef.current?.pause();
        stopSegment();
        if (!segmentPlayerRef.current) {
          segmentPlayerRef.current = createAudioPlayer({ uri }, { updateInterval: 60000 });
        } else {
          segmentPlayerRef.current.replace({ uri });
        }
        const seg = segmentPlayerRef.current;
        seg.setPlaybackRate(1, 'high');
        // Small lead-in/out so clipped consonants don't get chopped.
        const startMs = Math.max(0, stamp.startMs - 40);
        const endMs = stamp.endMs + 60;
        void seg.seekTo(startMs / 1000).then(() => {
          seg.play();
          segmentTimerRef.current = setTimeout(() => seg.pause(), endMs - startMs);
        });
        trackEvent('word_segment_played', { sentenceId, tokenIndex });
      },
    }),
    [currentTrack, stopSegment],
  );

  // ---- teardown -----------------------------------------------------------
  React.useEffect(() => {
    return () => {
      stopSegment();
      const player = playerRef.current;
      if (player) {
        if (lockScreenActiveRef.current) player.clearLockScreenControls();
        player.remove();
        playerRef.current = null;
      }
      segmentPlayerRef.current?.remove();
      segmentPlayerRef.current = null;
    };
  }, [stopSegment]);

  return {
    available: playableTracks.length > 0,
    playableTracks,
    currentTrack,
    mode: index?.mode ?? null,
    playing,
    positionMs,
    durationMs: currentTrack?.durationMs ?? 0,
    rate,
    error,
    activeWord,
    activeSentenceIdx: activeSentence?.idx ?? null,
    activeSentenceId: activeSentence?.id ?? null,
    toggle,
    lastUserSeekAtRef,
    seekToMs,
    seekToSentence,
    cycleRate,
    switchTrack,
    segments,
  };
}
