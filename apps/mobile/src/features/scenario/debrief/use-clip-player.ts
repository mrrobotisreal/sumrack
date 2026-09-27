import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as React from 'react';

/**
 * One small expo-audio player shared by every ▶ on the debrief (T63
 * §10.2): pressing a clip stops whatever was playing, plays the new file,
 * and reports which key is active so the row can show ⏸. Files may be WAV
 * or OGG — the platform decoder takes both. Released on unmount (T61 rule:
 * consumers drop the player before `release()`; here the hook owns both).
 */
export interface ClipPlayer {
  /** The key of the clip playing right now, else null. */
  playing: string | null;
  /** Play `uri` under `key`; a second press on the same key stops it. */
  toggle: (key: string, uri: string) => boolean;
  stop: () => void;
}

export function useClipPlayer(): ClipPlayer {
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);

  const stop = React.useCallback(() => {
    const p = playerRef.current;
    playerRef.current = null;
    setPlaying(null);
    if (p) {
      try {
        p.pause();
        p.release();
      } catch {
        // already released
      }
    }
  }, []);

  React.useEffect(() => stop, [stop]);

  const toggle = React.useCallback(
    (key: string, uri: string): boolean => {
      if (playerRef.current && playing === key) {
        stop();
        return false;
      }
      stop();
      try {
        if (!new File(uri).exists) return false;
        const player = createAudioPlayer({ uri }, { updateInterval: 250 });
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (s) => {
          if (s.didJustFinish && playerRef.current === player) stop();
        });
        player.play();
        setPlaying(key);
        return true;
      } catch {
        stop();
        return false;
      }
    },
    [playing, stop],
  );

  return { playing, toggle, stop };
}
