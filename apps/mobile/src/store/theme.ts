import { colorScheme } from 'nativewind';
import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

/**
 * Theme mode, persisted in the `settings` DB table (migrated off the T01
 * AsyncStorage store by the T03 bootstrap). The store itself is plain
 * zustand: DbProvider calls hydrateThemeFromDb() once migrations have run,
 * and setMode writes through to settings fire-and-forget.
 * Dark is the app's default identity (design §10).
 */
export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  setMode: (mode) => {
    colorScheme.set(mode);
    set({ mode });
    track('theme_mode_changed', { mode });
    void repos.settings.set(SETTING_KEYS.themeMode, mode);
  },
}));

/** Load the persisted mode after the DB is ready (called by DbProvider). */
export async function hydrateThemeFromDb(): Promise<void> {
  const mode = await repos.settings.get<ThemeMode>(SETTING_KEYS.themeMode);
  if (mode === 'dark' || mode === 'light' || mode === 'system') {
    colorScheme.set(mode);
    useThemeStore.setState({ mode });
  }
}

// Apply the default before hydration resolves so first paint is dark,
// not the RN default light flash.
colorScheme.set('dark');
