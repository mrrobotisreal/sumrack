import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { AsrSettingsSection } from '@/features/pronunciation/asr-settings-section';
import { DailySettingsSection } from '@/features/review/daily/daily-settings-section';
import { SyncSettingsSection } from '@/features/sync/sync-settings-section';
import { VoicesSettingsSection } from '@/features/tts/voices-settings-section';
import { track } from '@/services/analytics';
import { useGamePrefs } from '@/store/game-prefs';
import { useLookupPrefs } from '@/store/lookup-prefs';
import { useThemeStore, type ThemeMode } from '@/store/theme';
import { useAppTheme } from '@/theme/use-app-theme';

const MODES: { mode: ThemeMode; label: string; hint: string }[] = [
  { mode: 'dark', label: 'Dark', hint: 'Сумрак — the default identity' },
  { mode: 'light', label: 'Light', hint: 'Warm paper, for daylight reading' },
  { mode: 'system', label: 'System', hint: 'Follow the device setting' },
];

/**
 * Placeholder settings screen (T01). Real settings sections are assembled
 * incrementally: voices/models (T11), sync (T07), AI (T16), backup (T20)…
 * The theme selector below is the one real control this ticket ships.
 */
export default function SettingsScreen() {
  const { mode, setMode } = useThemeStore();
  const { tokens } = useAppTheme();
  const { encounterOnLookup, setEncounterOnLookup } = useLookupPrefs();
  const { clozeUnseenStoriesAllowed, setClozeUnseenStoriesAllowed } = useGamePrefs();

  useFocusEffect(
    React.useCallback(() => {
      track('settings_opened');
    }, []),
  );

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-6"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Appearance
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        {MODES.map(({ mode: m, label, hint }, i) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === m }}
            className={`flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2 ${
              i > 0 ? 'border-t border-border' : ''
            }`}
          >
            <View className="gap-0.5">
              <Text className="font-ui-medium">{label}</Text>
              <Text variant="caption">{hint}</Text>
            </View>
            {mode === m ? (
              <Ionicons name="checkmark-circle" size={22} color={tokens.accent} />
            ) : (
              <Ionicons name="ellipse-outline" size={22} color={tokens.textMuted} />
            )}
          </Pressable>
        ))}
      </View>

      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Reading
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Encounter on tap-lookup</Text>
            <Text variant="caption">
              Tapping a word already in your bank logs a new encounter automatically
            </Text>
          </View>
          <Switch
            value={encounterOnLookup}
            onValueChange={setEncounterOnLookup}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Encounter on tap-lookup"
          />
        </View>
      </View>

      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Games
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Allow unread stories</Text>
            <Text variant="caption">
              Cloze and sentence builder may quote sentences from stories you haven&apos;t read yet
              (spoilers!)
            </Text>
          </View>
          <Switch
            value={clozeUnseenStoriesAllowed}
            onValueChange={setClozeUnseenStoriesAllowed}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Allow unread stories in games"
          />
        </View>
      </View>

      <DailySettingsSection />

      <VoicesSettingsSection />
      <AsrSettingsSection />

      <SyncSettingsSection />

      {__DEV__ && (
        <>
          <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
            Developer
          </Text>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            <Link href="/dev-db" asChild>
              <Pressable className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2">
                <View className="gap-0.5">
                  <Text className="font-ui-medium">Database debug</Text>
                  <Text variant="caption">Imported packs, stories, FTS search (T03)</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
              </Pressable>
            </Link>
            <Link href="/dev-tts" asChild>
              <Pressable className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2">
                <View className="gap-0.5">
                  <Text className="font-ui-medium">Read any text</Text>
                  <Text variant="caption">Speak arbitrary Russian, voice QA + latency (T11)</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
              </Pressable>
            </Link>
          </View>
        </>
      )}

      <Text variant="caption" className="mt-8 text-center">
        More settings arrive with AI feedback (T16) and backup (T20).
      </Text>

      <View className="mt-10 items-center gap-2">
        <Image
          source={require('../../assets/images/icon.png')}
          style={{ width: 72, height: 72, borderRadius: 16 }}
          contentFit="cover"
          accessibilityLabel="Сумрак app icon"
        />
        <Text className="font-display text-2xl text-accent">Сумрак</Text>
        <Text variant="caption">v{Constants.expoConfig?.version ?? '0.0.0'}</Text>
      </View>
    </ScrollView>
  );
}
