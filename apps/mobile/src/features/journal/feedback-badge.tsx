import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { FeedbackStatus } from '@/db/schema';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * AI-feedback status chip (design §7.4: none → queued → done). T15 only
 * ever produces 'none'; T16 starts writing 'queued'/'done' — the component
 * is generic now so those states light up without UI work then.
 */
export function FeedbackBadge({ status }: { status: FeedbackStatus }) {
  const { tokens: theme } = useAppTheme();

  const config = {
    none: { icon: 'chatbubble-outline' as const, label: 'No feedback', color: theme.textMuted },
    queued: { icon: 'time-outline' as const, label: 'Queued', color: theme.accent },
    done: { icon: 'sparkles' as const, label: 'Feedback', color: theme.success },
  }[status];

  return (
    <View className="flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5">
      <Ionicons name={config.icon} size={11} color={config.color} />
      <Text className="text-xs" style={{ color: config.color }}>
        {config.label}
      </Text>
    </View>
  );
}
