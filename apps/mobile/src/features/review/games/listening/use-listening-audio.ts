import * as React from 'react';

import { clipVoiceId } from '@/features/tts/clip-voice';
import { getSpeechService } from '@/services/speech';

import type { ListeningAudio } from './audio-source';

/** Slow-replay rate — matches the narration bar's lowest speed (T10). */
export const SLOW_REPLAY_RATE = 0.7;

/**
 * Playback for one listening-quiz item. T85: the quiz never plays story audio
 * (word slices bled into neighbour words and stamp errors chopped the target),
 * so every item speaks its banked surface through the SpeechService with the
 * Piper clip voice (system voice when no Piper is installed). Slow replay drops
 * the rate to 0.7×. Auto-plays once on mount.
 */
export function useListeningAudio(audio: ListeningAudio) {
  const stop = React.useCallback(() => {
    void getSpeechService().stop();
  }, []);

  const play = React.useCallback(
    (slow: boolean) => {
      stop();
      const rate = slow ? SLOW_REPLAY_RATE : 1;
      void getSpeechService().speak(audio.text, { rate, voiceId: clipVoiceId() });
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

  // Silence speech on unmount.
  React.useEffect(() => {
    return () => {
      void getSpeechService().stop();
    };
  }, []);

  return { play, stop };
}
