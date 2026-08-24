import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

const DEFAULT_MESSAGE = "Couldn't load this — something went wrong reading the database.";

interface QueryErrorProps {
  /** Overrides the default one-line message. */
  message?: string;
  /** Retry affordance — usually `query.refetch` or a rebuild fn. */
  onRetry: () => void;
}

/**
 * Compact inline/section error surface (T22 hardening): a danger-tinted
 * icon, a one-line message, and a Retry pressable. Drop this in place of
 * an empty state whenever a query's `isError` is true — an empty list and
 * a failed read must never look the same.
 */
export function QueryError({ message = DEFAULT_MESSAGE, onRetry }: QueryErrorProps) {
  const { tokens } = useAppTheme();
  return (
    <View className="items-center gap-2 rounded-xl border border-border bg-surface px-4 py-6">
      <Ionicons name="alert-circle-outline" size={22} color={tokens.danger} />
      <Text variant="muted" className="text-center">
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        className="mt-1 min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
      >
        <Text className="text-accent">Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Full-screen-center variant — replaces an entire screen's content while
 * a query is in `isError`. Same anatomy as {@link QueryError}, just
 * centered in the viewport with generous side padding.
 */
export function QueryErrorScreen({ message, onRetry }: QueryErrorProps) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-1 items-center justify-center bg-bg px-8">
      <Ionicons
        name="alert-circle-outline"
        size={36}
        color={tokens.danger}
        style={{ marginBottom: 12 }}
      />
      <Text variant="muted" className="text-center">
        {message ?? DEFAULT_MESSAGE}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        className="mt-4 min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
      >
        <Text className="text-accent">Retry</Text>
      </Pressable>
    </View>
  );
}
