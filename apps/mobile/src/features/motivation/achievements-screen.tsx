import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ACHIEVEMENTS } from './achievements';
import { useAchievements } from './use-motivation';

/**
 * Achievement gallery (T19, §7.7) — every defined achievement, unlocked
 * ones lit with the ember accent + unlock date, locked ones dimmed. No
 * hidden entries: seeing the whole map is part of the motivation.
 */
export function AchievementsScreen() {
  const { tokens } = useAppTheme();
  const unlocked = useAchievements();

  useFocusEffect(
    React.useCallback(() => {
      track('achievements_gallery_opened');
    }, []),
  );

  if (unlocked.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void unlocked.refetch()} />
      </View>
    );
  }

  const unlockedAt = new Map((unlocked.data ?? []).map((a) => [a.id, a.unlockedAt]));
  const count = unlockedAt.size;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-2 px-4 pb-12 pt-4">
      <Text variant="caption" className="mb-1">
        {count} of {ACHIEVEMENTS.length} unlocked
      </Text>
      {ACHIEVEMENTS.map((a) => {
        const at = unlockedAt.get(a.id);
        const isUnlocked = at != null;
        return (
          <View
            key={a.id}
            className={`flex-row items-center gap-3 rounded-xl border bg-surface p-3.5 ${
              isUnlocked ? 'border-accent' : 'border-border'
            }`}
            style={isUnlocked ? undefined : { opacity: 0.55 }}
          >
            <View
              className={`h-11 w-11 items-center justify-center rounded-full ${
                isUnlocked ? 'bg-accent-soft' : 'bg-surface-2'
              }`}
            >
              <Ionicons
                name={a.icon}
                size={22}
                color={isUnlocked ? tokens.accent : tokens.textMuted}
              />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="font-ui-medium">{a.title}</Text>
              <Text variant="caption">{a.description}</Text>
              {isUnlocked && (
                <Text variant="caption" className="text-accent">
                  Unlocked {new Date(at).toLocaleDateString()}
                </Text>
              )}
            </View>
            {isUnlocked ? (
              <Ionicons name="checkmark-circle" size={20} color={tokens.accent} />
            ) : (
              <Ionicons name="lock-closed-outline" size={18} color={tokens.textMuted} />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
