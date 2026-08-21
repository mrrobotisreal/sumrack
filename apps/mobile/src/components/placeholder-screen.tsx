import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';

interface PlaceholderScreenProps {
  /** Russian screen title, e.g. «Сегодня» */
  title: string;
  /** One-line English description of what this screen becomes */
  subtitle: string;
  /** Ticket that builds the real screen, e.g. "T06" */
  ticket: string;
}

/**
 * Placeholder body for the T01 navigation shell. Every tab renders one of
 * these until its real feature ticket lands.
 */
export function PlaceholderScreen({ title, subtitle, ticket }: PlaceholderScreenProps) {
  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: title });
    }, [title]),
  );

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
      <Text className="font-reading-bold text-2xl text-text">{title}</Text>
      <Text variant="muted" className="text-center">
        {subtitle}
      </Text>
      <View className="mt-4 rounded-full border border-border bg-surface px-4 py-1.5">
        <Text variant="caption" className="text-accent">
          coming in {ticket}
        </Text>
      </View>
    </View>
  );
}
