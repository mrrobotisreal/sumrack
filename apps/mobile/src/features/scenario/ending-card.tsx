import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import type { Ending } from '@sumrak/schema';
import type { ScenarioRunStats } from '@/db/repositories/scenarios';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The ending card (T62 §9.4): the tone treatment from `ending-view.tsx`
 * (icon + label), `title` + `recap` RU with EN reveal, the run's numbers,
 * «Смотреть разбор» (T63 — the runs stub until then) · «Ещё раз» ·
 * «Следующий уровень» when a higher rung is installed. Restrained — the XP
 * toast already celebrated; this is the record.
 */

const TONE_ICON: Record<Ending['tone'], React.ComponentProps<typeof Ionicons>['name']> = {
  good: 'checkmark-circle-outline',
  bad: 'skull-outline',
  strange: 'eye-outline',
};

const TONE_LABEL: Record<Ending['tone'], string> = {
  good: 'Хорошая концовка',
  bad: 'Плохая концовка',
  strange: 'Странная концовка',
};

export function EndingCard({
  ending,
  level,
  titleRu,
  stats,
  newEnding,
  xp,
  nextLevel,
  onDebrief,
  onAgain,
  onNext,
  onClose,
}: {
  ending: Ending;
  /** The rung just finished — shown so an A1 and an A2 ending of the same title never look alike. */
  level: CefrLevel;
  titleRu: string;
  stats: ScenarioRunStats;
  newEnding: boolean;
  /** The XP just awarded (the toast's number, echoed here). */
  xp: number;
  nextLevel: string | null;
  onDebrief: () => void;
  onAgain: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [showEn, setShowEn] = React.useState(false);
  const clean = stats.turns > 0 && stats.cleanTurns === stats.turns;

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-6 pb-12 pt-6"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}
    >
      <View className="items-center gap-2">
        <View className="flex-row items-center gap-2">
          <LevelChip level={level} />
          <Text variant="caption" numberOfLines={1}>
            {titleRu}
          </Text>
        </View>
        <Ionicons name={TONE_ICON[ending.tone]} size={44} color={theme.accent} />
        <Text variant="caption" className="uppercase tracking-wider">
          {TONE_LABEL[ending.tone]}
          {newEnding ? ' · новая' : ''}
        </Text>
        <RNText className="text-center font-reading text-3xl text-text">{ending.title.ru}</RNText>
        <Text variant="muted">{ending.title.en}</Text>
      </View>

      <Pressable
        onPress={() => setShowEn((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={showEn ? 'Hide translation' : 'Show translation'}
        accessibilityState={{ expanded: showEn }}
        className="mt-6 rounded-xl border border-border bg-surface p-4"
      >
        <View className="flex-row items-start gap-2">
          <RNText className="flex-1 font-reading text-lg leading-7 text-text">
            {ending.recap.ru}
          </RNText>
          <Ionicons
            name={showEn ? 'language' : 'language-outline'}
            size={16}
            color={showEn ? theme.accent : theme.border}
          />
        </View>
        {showEn && (
          <RNText className="mt-2 border-l-2 border-accent/40 pl-3 font-reading-italic text-base text-text-muted">
            {ending.recap.en}
          </RNText>
        )}
      </Pressable>

      <View className="mt-5 flex-row gap-2">
        <Stat label="Turns" value={`${stats.cleanTurns}/${stats.turns}`} hint="clean" />
        <Stat label="Misses" value={String(stats.misses)} hint={`${stats.lifelines} hints`} />
        <Stat label="XP" value={`+${xp}`} hint={clean ? 'clean run' : 'finished'} />
      </View>

      <Pressable
        onPress={onDebrief}
        accessibilityRole="button"
        className="mt-6 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5 active:bg-surface-2"
      >
        <Ionicons name="list-outline" size={16} color={theme.accent} />
        <Text className="font-ui-medium text-accent">Смотреть разбор</Text>
      </Pressable>
      <View className="mt-3 flex-row gap-3">
        <Pressable
          onPress={onAgain}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Ionicons name="refresh" size={16} color={theme.bg} />
          <Text className="font-ui-medium text-bg">Ещё раз</Text>
        </Pressable>
        {nextLevel && (
          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-accent/50 bg-accent-soft py-3.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-accent">Следующий уровень · {nextLevel}</Text>
            <Ionicons name="arrow-forward" size={15} color={theme.accent} />
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        className="mt-3 items-center justify-center rounded-xl border border-border bg-surface py-3.5 active:bg-surface-2"
      >
        <Text className="font-ui-medium">Готово</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 rounded-xl border border-border bg-surface py-3">
      <Text variant="caption" className="uppercase tracking-wider">
        {label}
      </Text>
      <RNText className="font-ui-bold text-2xl text-text">{value}</RNText>
      <Text variant="caption">{hint}</Text>
    </View>
  );
}
