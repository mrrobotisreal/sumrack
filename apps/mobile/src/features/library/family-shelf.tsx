import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { nextRungLevel, rungFinished, type RungState } from '@/features/library/family-groups';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Family shelf header (T30.1): one shared title + tag chrome, a CEFR-ordered
 * level selector with per-rung progress, and the quiet next-rung nudge when
 * the selected rung is fully read (UI_DESIGN restraint — an inline row, no
 * modal, no celebration). Selector switching writes zero progress: it only
 * changes which rung's story cards render below.
 */
export function FamilyShelfHeader({
  slug,
  titleRu,
  tags,
  rungs,
  selectedLevel,
  onSelectRung,
}: {
  slug: string;
  titleRu: string;
  tags: string[];
  rungs: RungState[];
  selectedLevel: CefrLevel;
  onSelectRung: (to: CefrLevel, via: 'chip' | 'next-rung') => void;
}) {
  const { tokens } = useAppTheme();
  const next = nextRungLevel(rungs, selectedLevel);

  // "shown" fires once per (selection → target) pair per mounted shelf —
  // switching away and back does not re-log the same nudge.
  const shownRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!next) return;
    const key = `${selectedLevel}->${next}`;
    if (shownRef.current.has(key)) return;
    shownRef.current.add(key);
    track('family_next_rung_shown', { family: slug, from: selectedLevel, to: next });
  }, [next, selectedLevel, slug]);

  return (
    <View className="mb-2 mt-6 gap-1.5">
      <Text className="font-ui-medium text-lg" numberOfLines={1}>
        {titleRu}
      </Text>
      {tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {tags.map((tag) => (
            <View key={tag} className="rounded-full bg-surface-2 px-2 py-0.5">
              <Text variant="caption" className="text-xs">
                {tag}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View className="mt-1 flex-row flex-wrap gap-2">
        {rungs.map((rung) => (
          <RungChip
            key={rung.level}
            rung={rung}
            active={rung.level === selectedLevel}
            onPress={() => {
              if (rung.level !== selectedLevel) onSelectRung(rung.level, 'chip');
            }}
          />
        ))}
      </View>
      {next && (
        <Pressable
          onPress={() => onSelectRung(next, 'next-rung')}
          accessibilityRole="button"
          accessibilityLabel={`Next level: ${next}`}
          className="mt-0.5 flex-row items-center gap-1.5 self-start rounded-lg px-1 py-1 active:bg-surface-2"
        >
          <Text variant="caption" className="text-accent">
            Следующий уровень: {next}
          </Text>
          <Ionicons name="arrow-forward" size={13} color={tokens.accent} />
        </Pressable>
      )}
    </View>
  );
}

function RungChip({
  rung,
  active,
  onPress,
}: {
  rung: RungState;
  active: boolean;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const finished = rungFinished(rung);
  const pct = rung.storyCount > 0 ? Math.round((rung.finishedCount / rung.storyCount) * 100) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Level ${rung.level}${finished ? ', finished' : pct > 0 ? `, ${pct}% finished` : ''}`}
      className={`flex-row items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 ${
        active ? 'border-accent bg-accent-soft' : 'border-border bg-surface active:bg-surface-2'
      }`}
    >
      <LevelChip level={rung.level} />
      {finished ? (
        <Ionicons name="checkmark-circle" size={14} color={tokens.accent} />
      ) : pct > 0 ? (
        <Text variant="caption" className={`text-xs ${active ? 'text-accent' : ''}`}>
          {pct}%
        </Text>
      ) : null}
    </Pressable>
  );
}
