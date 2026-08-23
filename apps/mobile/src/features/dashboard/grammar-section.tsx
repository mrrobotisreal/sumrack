import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { LevelChip, type CefrLevel } from '@/components/level-chip';
import type { GrammarTopicStats } from '@/db/repositories/dashboard';
import { useAppTheme } from '@/theme/use-app-theme';

import { LegendItem, SegmentedBar, mixHex } from './charts';
import { EmptyHint, SectionCard } from './section-card';

/**
 * Grammar coverage (design §7.6): per level, topics practiced / seen /
 * shipped, with the expandable topic checklist. "Seen" = met in read
 * sentences; "practiced" = at least one of the topic's lemmas has review
 * history (T18 definition, recorded in the ticket notes). Topics from a
 * course-unit lesson list are marked ★ (the level's core list).
 */
export function GrammarSection({
  data,
  onPracticeTopic,
}: {
  data: GrammarTopicStats[];
  onPracticeTopic: (level: CefrLevel, topic: string) => void;
}) {
  const { tokens } = useAppTheme();
  const [expanded, setExpanded] = React.useState<CefrLevel | null>(null);

  const byLevel = React.useMemo(() => {
    const map = new Map<CefrLevel, GrammarTopicStats[]>();
    for (const t of data) {
      const list = map.get(t.level) ?? [];
      list.push(t);
      map.set(t.level, list);
    }
    return map;
  }, [data]);

  if (data.length === 0) {
    return (
      <SectionCard title="Grammar coverage">
        <EmptyHint>
          No grammar-tagged content installed yet — course units and tagged stories fill this in.
        </EmptyHint>
      </SectionCard>
    );
  }

  const practicedColor = tokens.accent;
  const seenColor = mixHex(tokens.accent, tokens.surface, 0.45);
  const trackColor = mixHex(tokens.text, tokens.surface, 0.05);

  return (
    <SectionCard title="Grammar coverage">
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <LegendItem color={practicedColor} label="practiced" />
        <LegendItem color={seenColor} label="seen only" />
      </View>
      <View className="mt-4 gap-4">
        {[...byLevel.entries()].map(([level, topics]) => {
          const practiced = topics.filter((t) => t.lemmasReviewed > 0).length;
          const seenOnly = topics.filter(
            (t) => t.lemmasReviewed === 0 && t.readSentenceCount > 0,
          ).length;
          const isOpen = expanded === level;
          return (
            <View key={level} className="gap-1.5">
              <Pressable
                onPress={() => setExpanded(isOpen ? null : level)}
                accessibilityRole="button"
                accessibilityLabel={`${level} grammar topics`}
                className="gap-1.5"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <LevelChip level={level} />
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={tokens.textMuted}
                    />
                  </View>
                  <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                    {practiced} practiced / {topics.length} topics
                  </Text>
                </View>
                <SegmentedBar
                  segments={[
                    { value: practiced, color: practicedColor },
                    { value: seenOnly, color: seenColor },
                  ]}
                  total={topics.length}
                  trackColor={trackColor}
                />
              </Pressable>
              {isOpen && (
                <View className="mt-1 gap-0.5">
                  {topics.map((t) => (
                    <TopicRow
                      key={t.topic}
                      topic={t}
                      onPractice={
                        t.lemmasTotal > 0 ? () => onPracticeTopic(level, t.topic) : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </SectionCard>
  );
}

function TopicRow({ topic, onPractice }: { topic: GrammarTopicStats; onPractice?: () => void }) {
  const { tokens } = useAppTheme();
  const practiced = topic.lemmasReviewed > 0;
  const seen = topic.readSentenceCount > 0;
  const icon = practiced ? 'checkmark-circle' : seen ? 'ellipse-outline' : 'remove-circle-outline';
  const iconColor = practiced ? tokens.accent : seen ? tokens.textMuted : tokens.border;
  return (
    <Pressable
      onPress={onPractice}
      disabled={!onPractice}
      accessibilityRole={onPractice ? 'button' : undefined}
      accessibilityLabel={onPractice ? `Practice ${topic.topic}` : undefined}
      className="flex-row items-center gap-2 rounded-lg px-1 py-1.5 active:bg-surface-2"
    >
      <Ionicons name={icon} size={15} color={iconColor} />
      <Text className="flex-1 text-sm" numberOfLines={1}>
        {topic.topic}
        {topic.core ? ' ★' : ''}
      </Text>
      <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
        {topic.lemmasReviewed}/{topic.lemmasTotal}
      </Text>
      {onPractice && <Ionicons name="play-circle-outline" size={16} color={tokens.accent} />}
    </Pressable>
  );
}
