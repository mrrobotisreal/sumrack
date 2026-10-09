import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { queryKeys } from '@/db/hooks';
import { repos } from '@/db';
import type { LeechCandidate } from '@/db/repositories/dashboard';
import { ExplainSheet } from '@/features/ai/explain-sheet';
import type { ExplainTarget } from '@/features/ai/explain';
import { applyCardAction } from '@/features/review/card-actions';
import { DIRECTION_LABELS } from '@/features/review/format';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { dashboardKeys, useLeechInbox } from './hooks';
import { LEECH_AGAIN_MIN, LEECH_WINDOW } from './science/leeches';

/**
 * The leeches inbox (T38, V2 §7.7): cards with ≥ 4 `Again` in their last 10
 * reviews, minus acknowledged ones. Per item: AI explain (online, T16's
 * explain-this with a leech framing), add note (prefilled, linked to the
 * lemma in its text), drill now (the T18 `focus` route), suspend (T39 —
 * stops this direction; the repo drops it from the inbox), dismiss.
 */
export function LeechInboxScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const inbox = useLeechInbox();
  const { tokens } = useAppTheme();
  const [explain, setExplain] = React.useState<ExplainTarget | null>(null);

  const count = inbox.data?.length;
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (count == null || opened.current) return;
    opened.current = true;
    track('leech_inbox_opened', { count });
  }, [count]);

  useFocusEffect(
    React.useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.leeches });
    }, [queryClient]),
  );

  const act = React.useCallback(
    (action: 'explain' | 'note' | 'drill' | 'suspend' | 'dismiss', l: LeechCandidate) => {
      track('leech_action', { action, direction: l.direction, againCount: l.againCount });
      const headword = l.lemma ?? l.surface;
      if (action === 'explain') {
        setExplain({
          kind: 'card',
          headword,
          translation: l.translation || undefined,
          surface: l.surface || undefined,
          leech: { againCount: l.againCount, windowSize: l.windowSize, direction: l.direction },
        });
      } else if (action === 'note') {
        const title = `${headword} — трудное слово`;
        const body = `**${headword}** — ${l.translation}\n\n(${DIRECTION_LABELS[l.direction as keyof typeof DIRECTION_LABELS] ?? l.direction} · Again ×${l.againCount} of the last ${l.windowSize})\n\n`;
        router.push({ pathname: '/notes/[id]', params: { id: 'new', title, body } });
      } else if (action === 'drill') {
        router.push(`/review/daily?focus=${l.bankItemId}`);
      } else if (action === 'suspend') {
        void applyCardAction(
          'suspend',
          { id: l.cardId, direction: l.direction },
          'leech-inbox',
        ).then(() => {
          void queryClient.invalidateQueries({ queryKey: dashboardKeys.leeches });
          void queryClient.invalidateQueries({ queryKey: dashboardKeys.forecast });
          void queryClient.invalidateQueries({ queryKey: queryKeys.dueCount });
          void queryClient.invalidateQueries({ queryKey: queryKeys.dueCountMixed });
          void queryClient.invalidateQueries({ queryKey: queryKeys.dueCountProduction });
        });
      } else {
        void repos.dashboard.dismissLeech(l.cardId).then(() => {
          void queryClient.invalidateQueries({ queryKey: dashboardKeys.leeches });
        });
      }
    },
    [router, queryClient],
  );

  if (inbox.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }
  if (inbox.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void inbox.refetch()} />
      </View>
    );
  }

  const items = inbox.data ?? [];
  return (
    <View className="flex-1 bg-bg">
      <FlatList
        data={items}
        keyExtractor={(l) => l.cardId}
        contentContainerClassName="gap-3 px-4 pb-16 pt-4"
        ListHeaderComponent={
          <Text variant="caption" className="mb-1">
            Cards you answered «Again» at least {LEECH_AGAIN_MIN} times in their last {LEECH_WINDOW}{' '}
            reviews. Dismissed cards come back if they fail again.
          </Text>
        }
        ListEmptyComponent={
          <View className="items-center gap-2 py-16">
            <Ionicons name="leaf-outline" size={28} color={tokens.textMuted} />
            <Text className="font-ui-medium">Пиявок нет</Text>
            <Text variant="muted" className="text-center">
              No leeches right now — nothing keeps failing.
            </Text>
          </View>
        }
        renderItem={({ item }) => <LeechRow leech={item} onAction={act} />}
      />
      <ExplainSheet target={explain} onClose={() => setExplain(null)} />
    </View>
  );
}

function LeechRow({
  leech,
  onAction,
}: {
  leech: LeechCandidate;
  onAction: (a: 'explain' | 'note' | 'drill' | 'suspend' | 'dismiss', l: LeechCandidate) => void;
}) {
  const { tokens } = useAppTheme();
  const last = new Date(leech.lastReviewedAt);
  const dir = DIRECTION_LABELS[leech.direction as keyof typeof DIRECTION_LABELS] ?? leech.direction;
  return (
    <View
      className="rounded-xl border border-border bg-surface p-4"
      accessibilityLabel={`leech ${leech.lemma ?? leech.surface}`}
    >
      <View className="flex-row items-baseline gap-2">
        <Text className="font-reading text-lg" numberOfLines={1}>
          {leech.lemma ?? leech.surface}
        </Text>
        <Text variant="caption" className="flex-1" numberOfLines={1}>
          {leech.translation}
        </Text>
      </View>
      <Text variant="caption" className="mt-1" style={{ fontVariant: ['tabular-nums'] }}>
        {dir} · Again ×{leech.againCount}/{leech.windowSize} · last seen {last.getDate()}.
        {String(last.getMonth() + 1).padStart(2, '0')}
      </Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        <ActionChip
          icon="sparkles-outline"
          label="Explain"
          onPress={() => onAction('explain', leech)}
          color={tokens.accent}
        />
        <ActionChip
          icon="create-outline"
          label="Add note"
          onPress={() => onAction('note', leech)}
          color={tokens.accent}
        />
        <ActionChip
          icon="play-circle-outline"
          label="Drill now"
          onPress={() => onAction('drill', leech)}
          color={tokens.accent}
        />
        <ActionChip
          icon="pause-circle-outline"
          label="Suspend"
          onPress={() => onAction('suspend', leech)}
          color={tokens.accent}
        />
        <ActionChip
          icon="checkmark-done-outline"
          label="Dismiss"
          onPress={() => onAction('dismiss', leech)}
          color={tokens.textMuted}
        />
      </View>
    </View>
  );
}

function ActionChip({
  icon,
  label,
  onPress,
  color,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-10 flex-row items-center gap-1.5 rounded-full border border-border px-3 active:bg-surface-2"
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text className="text-sm">{label}</Text>
    </Pressable>
  );
}
