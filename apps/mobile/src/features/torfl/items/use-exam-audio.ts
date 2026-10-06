import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';

import { buildKaraokeIndex, activeWordAt, type ActiveWord } from '@/features/reader/karaoke';
import { getSpeechService } from '@/services/speech';

import type { ExamAudio } from './exam-audio';

/** Drill replay speeds: normal and the 0.75× slow replay (ticket). */
export const NORMAL_RATE = 1;
export const SLOW_RATE = 0.75;

/** Rough spoken length of a TTS string — only drives the `playing` flag (no end signal exists). */
function estimateTtsMs(text: string, rate: number): number {
  return Math.ceil((text.length * 75) / rate) + 400;
}

export interface ExamAudioControls {
  /** Start the span from its beginning; resolves once playback started. */
  play: (rate?: number) => void;
  stop: () => void;
  /** Plays started so far (the mock engine's counter: official audio plays twice). */
  playCount: number;
  playing: boolean;
  /** The word being spoken, when stamps exist and the span is playing. */
  activeWord: ActiveWord | null;
}

/**
 * `useExamAudio(audio)` (T70) — the one audio hook for exam items; T71's
 * `mode: 'exam'` listening player builds on it (`playCount` + `onEnded`).
 * Segment sources get their own expo-audio player (seek → play → timed
 * pause, the T10/T14 technique, span = first stamp − 150 ms … last + 250);
 * TTS sources go through the SpeechService. `onEnded` fires when a play
 * finishes (timer-based; stop() does not fire it).
 */
export function useExamAudio(
  audio: ExamAudio | null,
  opts: { onEnded?: () => void; onPlay?: (playNo: number) => void } = {},
): ExamAudioControls {
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const onEndedRef = React.useRef(opts.onEnded);
  const onPlayRef = React.useRef(opts.onPlay);
  onEndedRef.current = opts.onEnded;
  onPlayRef.current = opts.onPlay;
  const [playCount, setPlayCount] = React.useState(0);
  const playCountRef = React.useRef(0);
  const [playing, setPlaying] = React.useState(false);
  const [activeWord, setActiveWord] = React.useState<ActiveWord | null>(null);

  const index = React.useMemo(
    () =>
      audio && audio.stamps.length > 0
        ? buildKaraokeIndex(
            audio.transcript.map((s) => ({ id: s.id, ru: s.ru })),
            audio.stamps,
            0,
          )
        : null,
    [audio],
  );

  const clearTimers = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    timerRef.current = null;
    pollRef.current = null;
  }, []);

  const stop = React.useCallback(() => {
    clearTimers();
    playerRef.current?.pause();
    void getSpeechService().stop();
    setPlaying(false);
    setActiveWord(null);
  }, [clearTimers]);

  const finish = React.useCallback(() => {
    clearTimers();
    setPlaying(false);
    setActiveWord(null);
    onEndedRef.current?.();
  }, [clearTimers]);

  const play = React.useCallback(
    (rate: number = NORMAL_RATE) => {
      if (!audio) return;
      stop();
      playCountRef.current += 1;
      setPlayCount(playCountRef.current);
      onPlayRef.current?.(playCountRef.current);
      setPlaying(true);
      const { source } = audio;
      if (source.kind === 'tts') {
        void getSpeechService().speak(source.text, { rate });
        timerRef.current = setTimeout(finish, estimateTtsMs(source.text, rate));
        return;
      }
      if (!playerRef.current) {
        playerRef.current = createAudioPlayer({ uri: source.uri }, { updateInterval: 60_000 });
      }
      const player = playerRef.current;
      player.setPlaybackRate(rate, 'high');
      const sliceMs = Math.max(0, source.endMs - source.startMs);
      void player.seekTo(source.startMs / 1000).then(() => {
        player.play();
        timerRef.current = setTimeout(
          () => {
            player.pause();
            finish();
          },
          Math.ceil(sliceMs / rate),
        );
        if (index) {
          pollRef.current = setInterval(() => {
            setActiveWord(activeWordAt(index, Math.round(player.currentTime * 1000)));
          }, 80);
        }
      });
    },
    [audio, stop, finish, index],
  );

  React.useEffect(
    () => () => {
      clearTimers();
      playerRef.current?.pause();
      void getSpeechService().stop();
      playerRef.current?.remove();
      playerRef.current = null;
    },
    [clearTimers],
  );

  return { play, stop, playCount, playing, activeWord };
}
