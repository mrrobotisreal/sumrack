import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Linking, Pressable, Switch, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useNotificationPrefs } from '@/store/notification-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import type { NotificationPrefs } from './notification-prefs';
import {
  getNotificationPermission,
  replanReminders,
  requestNotificationPermission,
  type PermissionState,
} from './notifications';

/**
 * Notification settings (T19, §7.7): master toggle (the permission
 * first-touch point), reminder hours, quiet hours, and a permission-denied
 * affordance that routes to the OS settings (ticket item 7 — everything
 * else keeps working; notifications are just silently skipped).
 */
export function NotificationsSettingsSection() {
  const { tokens } = useAppTheme();
  const { prefs, setPrefs } = useNotificationPrefs();
  const [permission, setPermission] = React.useState<PermissionState>('undetermined');

  React.useEffect(() => {
    void getNotificationPermission().then(setPermission);
  }, []);

  const toggleMaster = async (enabled: boolean) => {
    if (enabled) {
      const state = await requestNotificationPermission();
      setPermission(state);
    }
    setPrefs({ enabled });
    void replanReminders();
  };

  const setHour = (key: keyof NotificationPrefs, value: number) => {
    setPrefs({ [key]: ((value % 24) + 24) % 24 });
    void replanReminders();
  };

  const showDenied = prefs.enabled && permission !== 'granted';

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Notifications
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Reminders</Text>
            <Text variant="caption">
              Morning queue-ready, evening streak-at-risk, new content after sync
            </Text>
          </View>
          <Switch
            value={prefs.enabled}
            onValueChange={(v) => void toggleMaster(v)}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Enable notifications"
          />
        </View>

        {showDenied && (
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            className="flex-row items-center gap-2 border-t border-border px-4 py-3 active:bg-surface-2"
          >
            <Ionicons name="alert-circle-outline" size={18} color={tokens.accent} />
            <View className="flex-1 gap-0.5">
              <Text className="font-ui-medium text-accent">Permission not granted</Text>
              <Text variant="caption">
                Android is blocking notifications — tap to open system settings
              </Text>
            </View>
          </Pressable>
        )}

        {prefs.enabled && (
          <>
            <HourRow
              label="Morning reminder"
              hint="Review queue ready (only when cards are due)"
              value={prefs.morningHour}
              onChange={(v) => setHour('morningHour', v)}
            />
            <HourRow
              label="Evening reminder"
              hint="Streak at risk (only while a streak is live)"
              value={prefs.eveningHour}
              onChange={(v) => setHour('eveningHour', v)}
            />
            <HourRow
              label="Quiet hours start"
              hint="No notifications from here…"
              value={prefs.quietStartHour}
              onChange={(v) => setHour('quietStartHour', v)}
            />
            <HourRow
              label="Quiet hours end"
              hint="…until here (same value disables quiet hours)"
              value={prefs.quietEndHour}
              onChange={(v) => setHour('quietEndHour', v)}
            />
          </>
        )}
      </View>
    </>
  );
}

function HourRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-row items-center justify-between border-t border-border px-4 py-3">
      <View className="flex-1 gap-0.5 pr-3">
        <Text className="font-ui-medium">{label}</Text>
        <Text variant="caption">{hint}</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => onChange(value - 1)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Earlier ${label}`}
          className="h-9 w-9 items-center justify-center rounded-full bg-surface-2 active:bg-border"
        >
          <Ionicons name="remove" size={18} color={tokens.text} />
        </Pressable>
        <RNText className="w-12 text-center font-ui-medium text-base text-text">
          {String(value).padStart(2, '0')}:00
        </RNText>
        <Pressable
          onPress={() => onChange(value + 1)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Later ${label}`}
          className="h-9 w-9 items-center justify-center rounded-full bg-surface-2 active:bg-border"
        >
          <Ionicons name="add" size={18} color={tokens.text} />
        </Pressable>
      </View>
    </View>
  );
}
