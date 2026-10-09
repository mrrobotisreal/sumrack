import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { useDailyQuest } from './use-daily-quest';
import { XP_TABLE } from './xp';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Today's quest card (T34, V2 §7.10): what the quest is, how far along, and
 * one tap into the activity that completes it. Renders nothing on a
 * quest-less day. A finished quest stays as a quiet done-row (no launch).
 */
export function QuestCard() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const state = useDailyQuest().data?.state ?? null;
  if (!state) return null;

  const { kind, progress, target, complete } = state;
  const fraction = target > 0 ? Math.min(1, progress / target) : 0;

  return (
    <Pressable
      disabled={complete}
      onPress={() => {
        track('quest_launched', { kind: kind.id, from: 'today' });
        router.push(kind.launch);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Today's quest: ${kind.title}, ${progress} of ${target}${complete ? ', done' : ''}`}
      className="flex-row items-center gap-3.5 rounded-xl border border-border bg-surface p-4 active:bg-surface-2"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2">
        <Ionicons
          name={(complete ? 'checkmark-circle' : kind.icon) as IoniconName}
          size={22}
          color={tokens.gold}
        />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between">
          <Text variant="caption" className="uppercase tracking-wider">
            Quest · {complete ? 'done' : `+${XP_TABLE.questCompleted} XP`}
          </Text>
          <Text variant="caption">
            {progress} / {target}
          </Text>
        </View>
        <Text className="font-ui-medium text-base">{kind.title}</Text>
        {!complete && <Text variant="caption">{kind.subtitle}</Text>}
        <View className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <View
            className="h-full rounded-full"
            style={{ width: `${fraction * 100}%`, backgroundColor: tokens.gold }}
          />
        </View>
      </View>
      {!complete && <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />}
    </Pressable>
  );
}
