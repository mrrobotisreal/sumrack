import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme } from 'nativewind';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { track } from '@/services/analytics';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

/**
 * Theme-mode persistence, pre-DB. Decision (T01): zustand persist over
 * AsyncStorage; migrates into the `settings` DB table when T03 lands.
 * Dark is the app's default identity (design §10).
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'dark',
      setMode: (mode) => {
        colorScheme.set(mode);
        set({ mode });
        track('theme_mode_changed', { mode });
      },
    }),
    {
      name: 'sumrak-theme',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Apply the persisted mode to NativeWind as soon as it loads.
        colorScheme.set(state?.mode ?? 'dark');
      },
    },
  ),
);

// Apply the default before rehydration resolves so first paint is dark,
// not the RN default light flash.
colorScheme.set('dark');
