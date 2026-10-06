import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { countdownLabel, placeholderReadiness, type ReadinessView } from './hub-model';
import { useExamDate } from './hooks';
import { ReadinessBars } from './readiness-bars';

/**
 * The pinned hub card at the top of the Library «ТРКИ» shelf (T69, TORFL
 * §5.2 item 1) — also inside the shelf's empty state, because the hub is
 * useful before any pack syncs. Countdown from `torfl.examDate`, five
 * readiness mini-bars («—» until T70 passes `readiness`), tap → `/torfl`.
 */
export function TorflHubCard({ readiness }: { readiness?: readonly ReadinessView[] }) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const { date, today } = useExamDate();
  const rows = readiness ?? placeholderReadiness();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/torfl', params: { from: 'library' } })}
      accessibilityRole="button"
      accessibilityLabel={`ТРКИ-А1. ${countdownLabel(date, today)}. Открыть подготовку к экзамену`}
      testID="torfl-hub-card"
      className="gap-3 rounded-2xl border border-accent/40 bg-surface px-4 py-4 active:bg-surface-2"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
          <Ionicons name="ribbon-outline" size={20} color={tokens.accent} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-ui-bold text-base">ТРКИ-А1 · Элементарный уровень</Text>
          <Text variant="caption" className={date ? 'text-accent' : undefined}>
            {countdownLabel(date, today)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
      </View>
      <ReadinessBars rows={rows} compact />
    </Pressable>
  );
}
