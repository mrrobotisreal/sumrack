import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
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

  useFocusEffect(
    React.useCallback(() => {
      track('settings_opened');
    }, []),
  );

  return (
    <View className="flex-1 bg-bg px-4 pt-6">
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

      <Text variant="caption" className="mt-8 text-center">
        More settings arrive with sync (T07), voices (T11), and backup (T20).
      </Text>
    </View>
  );
}
