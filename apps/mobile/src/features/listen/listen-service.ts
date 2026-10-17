import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useStore } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track, type AnalyticsEvent } from '@/services/analytics';

import { createListenPlayer, type ListenDeps, type ListenState } from './listen-player';
import { sanitizeListenPrefs } from './prefs';
import { sanitizeProgress } from './progress';

/**
 * The module-singleton listen player wired to expo-audio + the real repos
 * (FULL_STORY_LISTEN §5.1). Importing this module is cheap: nothing native is
 * created until the first `open()`.
 */

let fallbackArtwork: Promise<string | undefined> | null = null;

/** Stage the bundled app icon once so the lock screen gets a file:// uri. */
function stageFallbackArtwork(): Promise<string | undefined> {
  fallbackArtwork ??= Asset.fromModule(require('../../../assets/images/icon.png'))
    .downloadAsync()
    .then((a) => a.localUri ?? undefined)
    .catch(() => undefined);
  return fallbackArtwork;
}

const deps: ListenDeps = {
  createPlayer: (uri) =>
    createAudioPlayer({ uri }, { updateInterval: 500 }) as AudioPlayer as ReturnType<
      ListenDeps['createPlayer']
    >,
  setAudioMode: () =>
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: true,
    }),
  getSource: (packId) => repos.listen.getListenSource(packId),
  loadProgress: async () =>
    sanitizeProgress(await repos.settings.get<unknown>(SETTING_KEYS.listenProgress)),
  saveProgress: (p) => repos.settings.set(SETTING_KEYS.listenProgress, p),
  loadPrefs: async () =>
    sanitizeListenPrefs(await repos.settings.get<unknown>(SETTING_KEYS.listenPrefs)),
  savePrefs: (p) => repos.settings.set(SETTING_KEYS.listenPrefs, p),
  getFallbackArtwork: stageFallbackArtwork,
  track: (event, props) => track(event as AnalyticsEvent, props),
  now: () => Date.now(),
};

export const listenPlayer = createListenPlayer(deps);

export function useListenStore<T>(selector: (s: ListenState) => T): T {
  return useStore(listenPlayer.store, selector);
}
