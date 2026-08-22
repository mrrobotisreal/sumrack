import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useDueCardCount, useProductionDueCount } from '@/db/hooks';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The standalone games menu (T13; UI_DESIGN §3 places it off Словарь).
 * Every implemented mode is launchable here on demand — sessions serve due
 * cards first and top up with the weakest, so there's always practice; each
 * screen owns its own empty state when the bank/stories can't feed it yet.
 */
export function GamesMenuScreen() {
  const due = useDueCardCount();
  const productionDue = useProductionDueCount();

  useFocusEffect(
    React.useCallback(() => {
      track('games_menu_opened');
    }, []),
  );

  const dueCount = due.data ?? 0;
  const pronCount = productionDue.data ?? 0;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-3 px-4 pb-12 pt-4">
      <GameRow
        icon="albums-outline"
        title="Review session"
        subtitle={
          dueCount > 0
            ? `Flashcards + multiple choice · ${dueCount} due`
            : 'Flashcards + multiple choice'
        }
        route="/review/session"
      />
      <GameRow
        icon="text-outline"
        title="Cloze"
        subtitle="Fill the missing word in real story sentences"
        route="/review/cloze"
      />
      <GameRow
        icon="reorder-four-outline"
        title="Sentence builder"
        subtitle="Rebuild story sentences from shuffled tiles"
        route="/review/sentence-builder"
      />
      <GameRow
        icon="mic-outline"
        title="Pronunciation"
        subtitle={
          pronCount > 0 ? `Say it out loud · ${pronCount} due` : 'Say it out loud, scored offline'
        }
        route="/review/pronunciation"
      />

      <Text variant="caption" className="mt-3 px-1 text-center">
        Cloze and sentence builder quote only stories you&apos;ve read — change that in Settings →
        Games. Listening quiz arrives with T14.
      </Text>
    </ScrollView>
  );
}

function GameRow({
  icon,
  title,
  subtitle,
  route,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  route: Href;
}) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={() => {
        track('game_launched_from_menu', { route: String(route) });
        router.push(route);
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="flex-row items-center gap-3.5 rounded-xl border border-border bg-surface p-4 active:bg-surface-2"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2">
        <Ionicons name={icon} size={20} color={tokens.accent} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-ui-medium text-base">{title}</Text>
        <Text variant="caption">{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
    </Pressable>
  );
}
