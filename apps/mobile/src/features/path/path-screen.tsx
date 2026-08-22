import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import type { CheckpointState, PathNode, UnitState } from './path-model';
import { useInvalidatePath, usePathState } from './use-path';

/**
 * Путь (design §7.5, UI_DESIGN §4): a vertical journey of course units and
 * checkpoints per level. The current node starts expanded; EVERY node is
 * tappable and every step inside is navigable regardless of state —
 * locked-looking UI is a design bug here (UI_DESIGN §4 "No locks, ever").
 * Completed units dim to embers.
 */
export function PathScreen() {
  const { tokens } = useAppTheme();
  const path = usePathState();
  const invalidate = useInvalidatePath();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      track('path_viewed');
      // Credit earned elsewhere (reading, reviews) since the last visit.
      invalidate();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (path.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  const state = path.data;
  if (!state || state.levels.length === 0) {
    return (
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="flex-grow justify-center px-8"
      >
        <View className="items-center gap-3">
          <Ionicons name="trail-sign-outline" size={40} color={tokens.textMuted} />
          <Text className="text-center font-reading text-xl">Путь ещё пуст</Text>
          <Text variant="muted" className="text-center">
            The guided path appears when course-unit packs are installed. Pull down in Библиотека to
            sync content.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const currentId = state.current?.pack.id ?? null;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-4 pb-16 pt-4">
      {state.levels.map((group) => (
        <View key={group.level}>
          <View className="mb-3 mt-2 flex-row items-center gap-3">
            <LevelChip level={group.level as CefrLevel} />
            <View className="h-px flex-1 bg-border" />
          </View>
          {group.nodes.map((node) => (
            <PathNodeCard
              key={node.pack.id}
              node={node}
              isCurrent={node.pack.id === currentId}
              expanded={(expandedId ?? currentId) === node.pack.id}
              onToggle={() => {
                const next = (expandedId ?? currentId) === node.pack.id ? '' : node.pack.id;
                setExpandedId(next);
                if (next) track('unit_expanded', { packId: node.pack.id, kind: node.kind });
              }}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function PathNodeCard({
  node,
  isCurrent,
  expanded,
  onToggle,
}: {
  node: PathNode;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View className="mb-3 flex-row gap-3">
      <JourneyRail node={node} isCurrent={isCurrent} />
      <View className="flex-1">
        {node.kind === 'unit' ? (
          <UnitNode unit={node} isCurrent={isCurrent} expanded={expanded} onToggle={onToggle} />
        ) : (
          <CheckpointNode checkpoint={node} expanded={expanded} onToggle={onToggle} />
        )}
      </View>
    </View>
  );
}

/** The vertical journey line: a node dot + connector (dims to embers when done). */
function JourneyRail({ node, isCurrent }: { node: PathNode; isCurrent: boolean }) {
  const { tokens } = useAppTheme();
  const done = node.kind === 'unit' ? node.complete : node.passed;
  const color = done ? tokens.accent : isCurrent ? tokens.text : tokens.textMuted;
  const icon =
    node.kind === 'checkpoint'
      ? 'flag'
      : done
        ? 'flame'
        : isCurrent
          ? 'ellipse'
          : 'ellipse-outline';
  return (
    <View className="w-6 items-center">
      <View className={`mt-4 ${done ? 'opacity-80' : isCurrent ? '' : 'opacity-50'}`}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View className="mt-1 w-px flex-1 bg-border" />
    </View>
  );
}

function UnitNode({
  unit,
  isCurrent,
  expanded,
  onToggle,
}: {
  unit: UnitState;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { tokens } = useAppTheme();
  const dim = unit.complete && !expanded;

  return (
    <View
      className={`rounded-xl border bg-surface ${
        isCurrent ? 'border-accent/50' : 'border-border'
      } ${dim ? 'opacity-60' : ''}`}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`Unit ${unit.pack.titleRu}`}
        className="flex-row items-center gap-3 p-4 active:bg-surface-2"
      >
        <View className="flex-1 gap-0.5">
          <RNText className="font-reading text-xl text-text">{unit.pack.titleRu}</RNText>
          <Text variant="caption">
            {unit.pack.titleEn} · {unit.stepsDone}/{unit.stepsTotal} steps
          </Text>
        </View>
        {unit.complete && <Ionicons name="checkmark-circle" size={20} color={tokens.accent} />}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={tokens.textMuted}
        />
      </Pressable>

      {expanded && (
        <View className="border-t border-border px-2 pb-2">
          <UnitSteps unit={unit} />
        </View>
      )}
    </View>
  );
}

function UnitSteps({ unit }: { unit: UnitState }) {
  const router = useRouter();
  const { tokens } = useAppTheme();

  return (
    <View>
      <StepRow
        icon="book-outline"
        done={unit.lessonRead}
        title="Grammar lesson"
        subtitle={unit.lessonRead ? 'Read' : 'A few minutes of theory first'}
        onPress={() => router.push(`/path/${unit.pack.id}/lesson`)}
      />
      {unit.stories.map((story) => (
        <StepRow
          key={story.storyId}
          icon="reader-outline"
          done={story.finished}
          title={story.titleRu}
          subtitle={story.finished ? 'Finished' : story.started ? 'In progress' : story.titleEn}
          onPress={() => router.push(`/reader/${unit.pack.id}/${story.storyId}?from=path`)}
        />
      ))}
      <StepRow
        icon="albums-outline"
        done={unit.goal.met}
        title="Review unit words"
        subtitle={
          unit.goal.target === 0
            ? 'No annotated words in this unit'
            : `${Math.min(unit.goal.reviewed, unit.goal.target)}/${unit.goal.target} reviewed · ${unit.goal.collected} collected`
        }
        onPress={() => router.push('/review/daily')}
      />
      <StepRow
        icon="school-outline"
        done={unit.quizPassed}
        title="Unit quiz"
        subtitle={
          unit.quizBestScorePercent != null
            ? `Best ${Math.round(unit.quizBestScorePercent)}%${unit.quizPassed ? ' · passed' : ''}`
            : 'Ten questions from this unit'
        }
        onPress={() => router.push(`/path/${unit.pack.id}/quiz`)}
      />
      {/* goal progress sliver */}
      {unit.goal.target > 0 && !unit.goal.met && (
        <View className="mx-2 mb-2 mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <View
            className="h-full rounded-full bg-accent"
            style={{
              width: `${Math.min(1, unit.goal.reviewed / unit.goal.target) * 100}%`,
              backgroundColor: tokens.accent,
            }}
          />
        </View>
      )}
    </View>
  );
}

function StepRow({
  icon,
  done,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  done: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-surface-2"
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-2">
        <Ionicons name={icon} size={15} color={done ? tokens.accent : tokens.textMuted} />
      </View>
      <View className="flex-1 gap-0.5">
        <RNText className="font-ui-medium text-base text-text">{title}</RNText>
        <Text variant="caption">{subtitle}</Text>
      </View>
      {done ? (
        <Ionicons name="checkmark-circle" size={18} color={tokens.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
      )}
    </Pressable>
  );
}

function CheckpointNode({
  checkpoint,
  expanded,
  onToggle,
}: {
  checkpoint: CheckpointState;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  return (
    <View
      className={`rounded-xl border bg-surface ${
        checkpoint.passed ? 'border-accent/40 opacity-80' : 'border-border'
      }`}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`Checkpoint ${checkpoint.pack.titleRu}`}
        className="flex-row items-center gap-3 p-4 active:bg-surface-2"
      >
        <Ionicons
          name={checkpoint.passed ? 'flag' : 'flag-outline'}
          size={18}
          color={checkpoint.passed ? tokens.accent : tokens.textMuted}
        />
        <View className="flex-1 gap-0.5">
          <RNText className="font-reading text-xl text-text">{checkpoint.pack.titleRu}</RNText>
          <Text variant="caption">
            {checkpoint.passed
              ? `Passed · best ${Math.round(checkpoint.bestScorePercent ?? 0)}%`
              : checkpoint.attempts > 0
                ? `Best ${Math.round(checkpoint.bestScorePercent ?? 0)}% · not passed yet`
                : checkpoint.pack.titleEn}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={tokens.textMuted}
        />
      </Pressable>
      {expanded && (
        <View className="border-t border-border p-4">
          <Text variant="muted">
            A mixed test across the level. Pass it to mark the milestone — retakes are always free.
          </Text>
          <Pressable
            onPress={() => router.push(`/path/checkpoint/${checkpoint.pack.id}`)}
            accessibilityRole="button"
            className="mt-3 items-center rounded-xl bg-accent py-3 active:opacity-80"
          >
            <Text className="font-ui-medium text-bg">
              {checkpoint.passed ? 'Take it again' : 'Take the test'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
