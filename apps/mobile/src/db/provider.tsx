import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import * as React from 'react';
import { Text, View } from 'react-native';

import migrations from '../../drizzle/migrations';
import { refreshInstalledAsr } from '@/features/pronunciation/asr-manager';
import { hydrateTtsFromDb } from '@/features/tts/service';
import { hydrateDailyPrefsFromDb } from '@/store/daily-prefs';
import { hydrateGamePrefsFromDb } from '@/store/game-prefs';
import { hydrateLookupPrefsFromDb } from '@/store/lookup-prefs';
import { hydrateReaderPrefsFromDb } from '@/store/reader-prefs';
import { hydrateThemeFromDb } from '@/store/theme';

import { runBootstrap } from './bootstrap';
import { db, repos } from './index';

/**
 * Gates the app on the database being ready: applies drizzle migrations
 * (bundled .sql via drizzle/migrations.js), then runs the idempotent
 * bootstrap (analytics sink, theme-setting migration, fixture pack
 * auto-import), then hydrates the theme store from the settings table.
 * Children render only in the 'ready' state, so every screen can assume
 * repositories work.
 */
export function DbProvider({ children }: { children: React.ReactNode }) {
  const { success, error: migrationError } = useMigrations(db, migrations);
  const [ready, setReady] = React.useState(false);
  const [bootError, setBootError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!success) return;
    let cancelled = false;
    void (async () => {
      try {
        await runBootstrap(db, repos);
        await hydrateThemeFromDb();
        await hydrateReaderPrefsFromDb();
        await hydrateLookupPrefsFromDb();
        await hydrateGamePrefsFromDb();
        await hydrateDailyPrefsFromDb();
        // Registers the real SpeechService (Piper/system) — T05's popup
        // speaker and all readback surfaces are live from here on.
        await hydrateTtsFromDb();
        // ASR install state for Settings + the pronunciation game's gate
        // (T12). The recognizer itself loads lazily at session start.
        await refreshInstalledAsr();
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error('[db] bootstrap failed', err);
        if (!cancelled) setBootError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [success]);

  if (migrationError || bootError) {
    // Pre-theme, pre-navigation surface — deliberately plain RN styles.
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B0B0E',
          padding: 24,
        }}
      >
        <Text style={{ color: '#E8E6E3', fontSize: 16, marginBottom: 8 }}>
          Database failed to initialize
        </Text>
        <Text style={{ color: '#9A97A0', fontSize: 13, textAlign: 'center' }}>
          {(migrationError ?? bootError)?.message}
        </Text>
      </View>
    );
  }

  if (!ready) return null; // splash screen still covers startup

  return <>{children}</>;
}
