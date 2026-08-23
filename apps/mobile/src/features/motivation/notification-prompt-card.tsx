import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';
import { useNotificationPrefs } from '@/store/notification-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { replanReminders, requestNotificationPermission } from './notifications';
import { useMotivation } from './use-motivation';

/**
 * One-time "protect your streak" card on Today (T19 ticket item 7): the
 * permission first-touch point outside Settings. Appears only once a streak
 * exists (there's something to protect), never on cold launch, and never
 * again after enable or dismiss.
 */
export function NotificationPromptCard() {
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const { prefs, setPrefs } = useNotificationPrefs();
  const motivation = useMotivation();

  const dismissed = useQuery({
    queryKey: ['notification-prompt-dismissed'],
    queryFn: async () =>
      (await repos.settings.get<boolean>(SETTING_KEYS.notificationPromptDismissed)) ?? false,
  });

  const streakDays = motivation.data?.streak.current ?? 0;
  if (prefs.enabled || dismissed.data !== false || streakDays < 1) return null;

  const dismiss = () => {
    track('notification_prompt_dismissed');
    void repos.settings
      .set(SETTING_KEYS.notificationPromptDismissed, true)
      .then(() => queryClient.invalidateQueries({ queryKey: ['notification-prompt-dismissed'] }));
  };

  const enable = async () => {
    track('notification_prompt_accepted');
    await requestNotificationPermission();
    setPrefs({ enabled: true });
    void replanReminders();
    void repos.settings
      .set(SETTING_KEYS.notificationPromptDismissed, true)
      .then(() => queryClient.invalidateQueries({ queryKey: ['notification-prompt-dismissed'] }));
  };

  return (
    <View className="rounded-xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="uppercase tracking-wider">
          Protect your streak
        </Text>
        <Pressable onPress={dismiss} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={tokens.textMuted} />
        </Pressable>
      </View>
      <Text variant="muted" className="mt-2">
        Get a nudge when cards are waiting or the streak is about to slip. Local only, quiet hours
        respected.
      </Text>
      <Pressable
        onPress={() => void enable()}
        accessibilityRole="button"
        className="mt-3 items-center rounded-xl bg-accent py-3 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">Enable reminders</Text>
      </Pressable>
    </View>
  );
}
