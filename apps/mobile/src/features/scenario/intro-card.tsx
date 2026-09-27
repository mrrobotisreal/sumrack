import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import type { ScenarioDetail } from '@/db/repositories/scenarios';
import { useAppTheme } from '@/theme/use-app-theme';

import { SPOKEN_COMMANDS } from './commands';
import { ScenarioScene, type SceneSpec } from './scene';

/**
 * The intro card (T62 §9.2): the scene with the host idle (blinking,
 * breathing), the `brief` (RU + «EN» reveal — the only text before the run),
 * «What you can say» (the five meta-intents RU + EN) and «Начать» /
 * «Продолжить» for a resumed run. The screen owns the haptic + bed fade.
 */
export function IntroCard({
  detail,
  spec,
  resumed,
  onStart,
  onRestart,
  onClose,
}: {
  detail: ScenarioDetail;
  spec: SceneSpec;
  /** A resumable run was restored: the primary becomes «Продолжить», «Начать заново» appears. */
  resumed: boolean;
  onStart: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const shape = useSharedValue(0);
  const [showEn, setShowEn] = React.useState(false);
  const s = detail.scenario;

  return (
    <View className="flex-1 bg-bg">
      <View style={{ flex: 1 }}>
        <ScenarioScene spec={spec} pose="idle" shape={shape} active style={{ flex: 1 }} />
        <View
          className="absolute left-0 right-0 flex-row items-center justify-between px-3"
          style={{ top: insets.top + 6 }}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to the hub"
            className="h-10 w-10 items-center justify-center rounded-full bg-scrim/40 active:opacity-70"
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <LevelChip level={s.level} />
        </View>
      </View>

      <ScrollView
        className="max-h-[52%] rounded-t-3xl border-t border-border bg-surface"
        contentContainerClassName="gap-4 px-5 pb-4 pt-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        <View className="gap-1">
          <RNText className="font-reading text-2xl text-text">{s.titleRu}</RNText>
          <Text variant="caption">{s.titleEn}</Text>
        </View>

        <Pressable
          onPress={() => setShowEn((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showEn ? 'Hide translation' : 'Show translation'}
          accessibilityState={{ expanded: showEn }}
          className="rounded-xl border border-border bg-bg p-4"
        >
          <View className="flex-row items-start gap-2">
            <RNText className="flex-1 font-reading text-lg leading-7 text-text">{s.briefRu}</RNText>
            <Ionicons
              name={showEn ? 'language' : 'language-outline'}
              size={16}
              color={showEn ? theme.accent : theme.border}
            />
          </View>
          {showEn && (
            <RNText className="mt-2 border-l-2 border-accent/40 pl-3 font-reading-italic text-base text-text-muted">
              {s.briefEn}
            </RNText>
          )}
        </Pressable>

        <View className="gap-1.5">
          <Text variant="caption" className="uppercase tracking-wider">
            Что можно сказать
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {SPOKEN_COMMANDS.map((c) => (
              <View
                key={c.intent}
                className="flex-row items-baseline gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1"
              >
                <RNText className="font-reading text-sm text-text">{c.ru}</RNText>
                <Text className="text-xs text-text-muted">{c.en}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel={resumed ? 'Continue the scenario' : 'Start the scenario'}
          className="flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Ionicons name={resumed ? 'play' : 'mic'} size={16} color={theme.bg} />
          <Text className="font-ui-medium text-bg">{resumed ? 'Продолжить' : 'Начать'}</Text>
        </Pressable>
        {resumed && (
          <Pressable
            onPress={onRestart}
            accessibilityRole="button"
            className="items-center py-1 active:opacity-70"
          >
            <Text variant="caption" className="text-accent">
              Начать заново
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
