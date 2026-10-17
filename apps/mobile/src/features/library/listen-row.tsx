import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ListenAvailability } from '@/db/repositories/listen';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { listenCaption } from './listen-row-format';
import { listenRowTrailing } from './listen-row-model';

export const LISTEN_ROW_LABEL = 'Прослушать всю историю';
export const LISTEN_PENDING_CAPTION = 'Аудио скачается по Wi-Fi';

/**
 * «Прослушать всю историю» (T97, FULL_STORY_LISTEN §2.1) — first row of every
 * expanded story section. `pending` (audio not downloaded yet) is muted and
 * disabled.
 */
export function ListenRow({
  packId,
  availability,
  progressPercent,
  finished = false,
  nowPlaying,
  indent = false,
  onPress,
}: {
  packId: string;
  availability: ListenAvailability;
  progressPercent: number | null;
  finished?: boolean;
  nowPlaying: boolean;
  indent?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const pending = availability.state === 'pending';
  const caption = pending ? LISTEN_PENDING_CAPTION : listenCaption(availability);
  const trailing = pending
    ? ({ kind: 'none' } as const)
    : listenRowTrailing({ nowPlaying, finished, progressPercent });
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityState={{ disabled: pending }}
      accessibilityLabel={`${LISTEN_ROW_LABEL}. ${caption}`}
      testID={`listen-row-${packId}`}
      className={cn(
        'mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2',
        indent && 'ml-3',
        pending && 'opacity-60',
      )}
    >
      <Ionicons name="play-circle" size={22} color={pending ? tokens.textMuted : tokens.accent} />
      <View className="flex-1 gap-0.5">
        <Text className="font-ui-medium text-base" numberOfLines={1}>
          {LISTEN_ROW_LABEL}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {trailing.kind === 'percent' && (
        <Text variant="caption" className="font-ui-medium">
          {trailing.text}
        </Text>
      )}
      {trailing.kind === 'done' && (
        <Ionicons name="checkmark-circle" size={20} color={tokens.accent} />
      )}
      {trailing.kind === 'playing' && (
        <View className="rounded-full bg-accent-soft px-2 py-0.5">
          <Text className="font-ui-medium text-xs text-accent">▶ Сейчас играет</Text>
        </View>
      )}
    </Pressable>
  );
}
