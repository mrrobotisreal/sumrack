import * as React from 'react';
import { AppState } from 'react-native';

import { useNarrationActivity } from '@/features/ambient-audio/activity';

import { listenPlayer, useListenStore } from './listen-service';

/**
 * Headless (FULL_STORY_LISTEN §5.2): the ambient bed obeys `playDuringNarration`
 * for the listen session exactly as for the reader; also saves progress when
 * the app is backgrounded.
 */
export function ListenActivityBridge() {
  const playing = useListenStore((s) => s.playing);
  useNarrationActivity(playing);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') listenPlayer.onBackground();
    });
    return () => sub.remove();
  }, []);
  return null;
}
