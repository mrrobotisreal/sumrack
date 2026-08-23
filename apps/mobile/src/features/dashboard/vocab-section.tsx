import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { LevelChip, type CefrLevel } from '@/components/level-chip';
import type { VocabLevelStats } from '@/db/repositories/dashboard';

import { LegendItem, SegmentedBar, useMasteryRamp } from './charts';
import { EmptyHint, SectionCard } from './section-card';

/**
 * Vocab-by-level (design §7.6): per CEFR level, a sequential mastery bar
 * over the encountered-lemma total — mature / young / shaky (learning) /
 * collected-unreviewed segments, encountered remainder as the track.
 */
export function VocabSection({ data }: { data: VocabLevelStats[] }) {
  const ramp = useMasteryRamp();
  const leveled = data.filter((d): d is VocabLevelStats & { level: CefrLevel } =>
    ['A1', 'A2', 'B1', 'B2', 'C1'].includes(d.level),
  );
  const unleveled = data.find((d) => d.level === 'unleveled');

  const totals = leveled.reduce(
    (acc, d) => ({
      reliable: acc.reliable + d.mature + d.young,
      shaky: acc.shaky + d.learning,
    }),
    { reliable: 0, shaky: 0 },
  );

  if (leveled.length === 0 && !unleveled) {
    return (
      <SectionCard title="Vocabulary">
        <EmptyHint>
          Ничего пока нет — read a story and collect words; mastery shows up here as you review
          them.
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Vocabulary">
      <Text className="font-ui-medium">
        You reliably know {totals.reliable} {totals.reliable === 1 ? 'lemma' : 'lemmas'};{' '}
        {totals.shaky} {totals.shaky === 1 ? 'is' : 'are'} shaky.
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
        <LegendItem color={ramp.mature} label="solid (30d+)" />
        <LegendItem color={ramp.young} label="young (7–30d)" />
        <LegendItem color={ramp.learning} label="shaky (<7d)" />
        <LegendItem color={ramp.unreviewed} label="unreviewed" />
      </View>

      <View className="mt-4 gap-4">
        {leveled.map((d) => {
          const unreviewed = d.collected - d.learning - d.young - d.mature;
          return (
            <View key={d.level} className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <LevelChip level={d.level} />
                <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                  {d.collected} collected · {d.encountered} met
                </Text>
              </View>
              <SegmentedBar
                segments={[
                  { value: d.mature, color: ramp.mature },
                  { value: d.young, color: ramp.young },
                  { value: d.learning, color: ramp.learning },
                  { value: unreviewed, color: ramp.unreviewed },
                ]}
                total={d.encountered}
                trackColor={ramp.track}
              />
            </View>
          );
        })}
      </View>

      {unleveled && unleveled.collected > 0 && (
        <Text variant="caption" className="mt-3">
          +{unleveled.collected} collected {unleveled.collected === 1 ? 'word' : 'words'} without a
          CEFR level yet (AI enrichment can fill levels in).
        </Text>
      )}
    </SectionCard>
  );
}
