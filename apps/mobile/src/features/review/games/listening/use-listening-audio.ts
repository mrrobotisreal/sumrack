import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';

import { getSpeechService } from '@/services/speech';

import type { ListeningAudio } from './audio-source';

/** Slow-replay rate — matches the narration bar's lowest speed (T10). */
export const SLOW_REPLAY_RATE = 0.7;

/** Lead-in/out around a stamped slice so consonants don't get chopped (T10 values). */
const SEGMENT_LEAD_IN_MS = 40;
const SEGMENT_LEAD_OUT_MS = 60;

/**
 * Playback for one listening-quiz item (T14). Segment sources get their own
 * expo-audio player (seek → play → timed pause, the T10 word-segment
 * technique); TTS sources go through the SpeechService (Piper when a voice
 * is installed, system voice otherwise — never network). Slow replay drops
 * the rate to 0.7× on both paths. Auto-plays once on mount.
 */
export function useListeningAudio(audio: ListeningAudio) {
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    playerRef.current?.pause();
    void getSpeechService().stop();
  }, []);

  const play = React.useCallback(
    (slow: boolean) => {
      stop();
      const rate = slow ? SLOW_REPLAY_RATE : 1;
      if (audio.kind === 'tts') {
        void getSpeechService().speak(audio.text, { rate });
        return;
      }
      if (!playerRef.current) {
        // Polling UI isn't needed — a huge updateInterval keeps status events quiet.
        playerRef.current = createAudioPlayer({ uri: audio.uri }, { updateInterval: 60_000 });
      }
      const player = playerRef.current;
      player.setPlaybackRate(rate, 'high');
      const startMs = Math.max(0, audio.startMs - SEGMENT_LEAD_IN_MS);
      const sliceMs = audio.endMs + SEGMENT_LEAD_OUT_MS - startMs;
      void player.seekTo(startMs / 1000).then(() => {
        player.play();
        timerRef.current = setTimeout(() => player.pause(), Math.ceil(sliceMs / rate));
      });
    },
    [audio, stop],
  );

  // Auto-play the clip once the item appears — the audio IS the prompt.
  React.useEffect(() => {
    const timer = setTimeout(() => play(false), 350);
    return () => clearTimeout(timer);
    // play is stable per item (audio identity); the view remounts per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    return () => {
      stop();
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, [stop]);

  return { play, stop };
}
