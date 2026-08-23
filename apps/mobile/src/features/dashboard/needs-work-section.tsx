import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type {
  GrammarTopicStats,
  WeakLemma,
  WeakPronunciationItem,
} from '@/db/repositories/dashboard';
import { useAppTheme } from '@/theme/use-app-theme';

import { EmptyHint, SectionCard } from './section-card';

/**
 * "What needs work" (design §7.6): the three ranked lists — worst-stability
 * lemmas, weakest seen grammar topics, weakest pronunciation items — each
 * with a one-tap practice-now action that launches a genuinely filtered
 * session (focus params, verified in T18 acceptance).
 */
export function NeedsWorkSection({
  weakLemmas,
  grammar,
  weakPronunciation,
  onPracticeLemmas,
  onPracticeTopic,
  onPracticePronunciation,
}: {
  weakLemmas: WeakLemma[];
  grammar: GrammarTopicStats[];
  weakPronunciation: WeakPronunciationItem[];
  onPracticeLemmas: (ids: string[]) => void;
  onPracticeTopic: (level: GrammarTopicStats['level'], topic: string) => void;
  onPracticePronunciation: (ids: string[]) => void;
}) {
  const { tokens } = useAppTheme();

  // Weakest *seen* topics with the lowest practiced ratio (T18 ranking).
  const weakTopics = React.useMemo(
    () =>
      grammar
        .filter((t) => t.readSentenceCount > 0 && t.lemmasTotal > 0)
        .sort(
          (a, b) =>
            a.lemmasReviewed / a.lemmasTotal - b.lemmasReviewed / b.lemmasTotal ||
            b.lemmasTotal - a.lemmasTotal,
        )
        .filter((t) => t.lemmasReviewed / t.lemmasTotal < 1)
        .slice(0, 3),
    [grammar],
  );

  const empty =
    weakLemmas.length === 0 && weakTopics.length === 0 && weakPronunciation.length === 0;

  return (
    <SectionCard title="What needs work">
      {empty ? (
        <EmptyHint>
          Пока всё в порядке — once you have review history, the weakest words and topics surface
          here.
        </EmptyHint>
      ) : (
        <View className="gap-5">
          {weakLemmas.length > 0 && (
            <View className="gap-1">
              <Text variant="caption">Shakiest words</Text>
              {weakLemmas.map((w) => (
                <View key={w.bankItemId} className="flex-row items-baseline gap-2 py-0.5">
                  <Text className="font-reading text-base" numberOfLines={1}>
                    {w.lemma ?? w.surface}
                  </Text>
                  <Text variant="caption" className="flex-1" numberOfLines={1}>
                    {w.translation}
                  </Text>
                  <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                    {w.minStability < 1 ? '<1d' : `${Math.round(w.minStability)}d`}
                  </Text>
                </View>
              ))}
              <PracticeButton
                label="Practice these words"
                onPress={() => onPracticeLemmas(weakLemmas.map((w) => w.bankItemId))}
              />
            </View>
          )}

          {weakTopics.length > 0 && (
            <View className="gap-1">
              <Text variant="caption">Weakest grammar topics</Text>
              {weakTopics.map((t) => (
                <Pressable
                  key={`${t.level}|${t.topic}`}
                  onPress={() => onPracticeTopic(t.level, t.topic)}
                  accessibilityRole="button"
                  accessibilityLabel={`Practice ${t.topic}`}
                  className="flex-row items-center gap-2 rounded-lg py-1 active:bg-surface-2"
                >
                  <Text className="flex-1 text-sm" numberOfLines={1}>
                    {t.topic} · {t.level}
                  </Text>
                  <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                    {t.lemmasReviewed}/{t.lemmasTotal} reviewed
                  </Text>
                  <Ionicons name="play-circle-outline" size={16} color={tokens.accent} />
                </Pressable>
              ))}
            </View>
          )}

          {weakPronunciation.length > 0 && (
            <View className="gap-1">
              <Text variant="caption">Speaking practice</Text>
              {weakPronunciation.map((p) => (
                <View key={p.bankItemId} className="flex-row items-baseline gap-2 py-0.5">
                  <Text className="font-reading text-base" numberOfLines={1}>
                    {p.surface}
                  </Text>
                  <Text variant="caption" className="flex-1" numberOfLines={1}>
                    {p.translation}
                  </Text>
                  <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                    {p.recentAvgScore != null
                      ? `${p.recentAvgScore} pts`
                      : `${Math.round(p.stability)}d`}
                  </Text>
                </View>
              ))}
              <PracticeButton
                label="Practice speaking"
                icon="mic-outline"
                onPress={() => onPracticePronunciation(weakPronunciation.map((p) => p.bankItemId))}
              />
            </View>
          )}
        </View>
      )}
    </SectionCard>
  );
}

function PracticeButton({
  label,
  onPress,
  icon = 'play',
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mt-1.5 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 py-2.5 active:opacity-80"
    >
      <Ionicons name={icon} size={14} color={tokens.accent} />
      <Text className="font-ui-medium text-sm text-accent">{label}</Text>
    </Pressable>
  );
}
