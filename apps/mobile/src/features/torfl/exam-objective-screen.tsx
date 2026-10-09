import { Ionicons } from '@expo/vector-icons';
import type { ChoiceItem, ExamItem, ExamSubtest, TypedItem } from '@sumrak/schema';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { fileExists } from './drill/drill-item';
import { buildLayout } from './engine/layout';
import { matrixCells } from './engine/matrix';
import type { ExamRunState, RunSubtest } from './engine/exam-machine';
import { formatClock, timerTone, dictionaryAllowed } from './engine/rules';
import { ExamMatrixSheet } from './exam-matrix-sheet';
import { loadItemAssets, type ExamPassage, type ItemAssets } from './items/exam-audio';
import { ChoiceItemView } from './items/choice-item-view';
import { ListeningPlayer } from './items/listening-player';
import { PassagePanel } from './items/passage-panel';
import { TypedItemView } from './items/typed-item-view';
import type { TorflLevel } from './level-profile';
import type { ExamAnswer } from './model';
import type { TorflPrefs } from './settings-core';
import { SUBTEST_LABELS } from './topics';

const TIMER_TONE_CLASS = {
  normal: 'text-text',
  amber: 'text-track-warm',
  red: 'text-danger',
} as const;

/**
 * The objective mock runner (T71, TORFL §8.2) for Лексика. Грамматика, Чтение
 * and Аудирование. Top bar = title · timer (amber ≤ 5:00, red ≤ 1:00) ·
 * «Матрица»; body = the part instruction + the item (reading adds the passage
 * with tap lookup per the dictionary rule; listening adds the engine-driven
 * exam player and shows the audio group's questions together); bottom = «‹ ›»
 * free navigation (listening: «Дальше» to the next text, never back) and ⚑.
 *
 * There is NO correctness indication anywhere: choices only highlight the
 * pick, typed answers are recorded silently, the matrix shows answered /
 * unanswered / flagged only.
 */
export function ExamObjectiveScreen({
  packId,
  level = 'A1',
  subtest,
  run,
  cursor,
  remainingMs,
  prefs,
  audioByKey,
  onAnswer,
  onFlag,
  onGoto,
  onNext,
  onAudioEnded,
  onSubmit,
  onQuit,
  onLookup,
}: {
  packId: string;
  /** T75 (THE LEVEL RULE): the exam's level for `exam_lookup_used`. */
  level?: TorflLevel;
  subtest: ExamSubtest;
  run: Pick<ExamRunState, 'answers' | 'flagged' | 'playCounts' | 'audio'>;
  cursor: RunSubtest;
  remainingMs: number;
  prefs: TorflPrefs;
  audioByKey: ReadonlyMap<string, ItemAssets> | null;
  onAnswer: (itemId: string, answer: ExamAnswer) => void;
  onFlag: (itemId: string) => void;
  onGoto: (flat: number) => void;
  onNext: () => void;
  onAudioEnded: () => void;
  onSubmit: () => void;
  onQuit: () => void;
  onLookup: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [matrixOpen, setMatrixOpen] = React.useState(false);
  const layout = React.useMemo(() => buildLayout(subtest), [subtest]);
  const linear = subtest.navigation === 'linear';
  const flat = cursor.flat;
  const group = layout.groups[layout.groupOf[flat] ?? 0]!;
  const lookup = dictionaryAllowed(subtest, prefs);
  const tone = timerTone(remainingMs);

  const cells = matrixCells(subtest, flat, run.answers, run.flagged);
  const itemsOfView: { item: ExamItem; number: number; partIdx: number; itemIdx: number }[] = linear
    ? layout.items
        .filter((i) => i.flat >= group.start && i.flat <= group.end)
        .map((i) => ({
          item: subtest.parts[i.partIdx]!.items[i.itemIdx]!,
          number: i.flat + 1,
          partIdx: i.partIdx,
          itemIdx: i.itemIdx,
        }))
    : (() => {
        const i = layout.items[flat]!;
        return [
          {
            item: subtest.parts[i.partIdx]!.items[i.itemIdx]!,
            number: flat + 1,
            partIdx: i.partIdx,
            itemIdx: i.itemIdx,
          },
        ];
      })();
  const part = subtest.parts[layout.items[flat]!.partIdx]!;
  const lastGroup = layout.groupOf[flat] === layout.groups.length - 1;

  const examAudio = linear && group.audioKey !== null ? audioByKey?.get(group.audioKey) : undefined;
  const playNo = group.audioKey !== null ? (run.playCounts[group.audioKey] ?? 0) : 0;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 4 }} testID="exam-runner">
      {/* top bar */}
      <View className="flex-row items-center gap-2 px-3 pb-2">
        <Pressable
          onPress={onQuit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Выйти из экзамена"
          testID="exam-quit"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-ui-medium" numberOfLines={1}>
            {SUBTEST_LABELS[subtest.kind].short}
          </Text>
          <Text variant="caption" className="text-xs">
            {linear ? `Задание ${flat + 1}–${group.end + 1}` : `Задание ${flat + 1}`} из{' '}
            {layout.items.length}
          </Text>
        </View>
        <Text
          className={cn('font-ui-bold text-lg tabular-nums', TIMER_TONE_CLASS[tone])}
          testID="exam-timer"
          accessibilityLabel={`Осталось ${formatClock(remainingMs)}`}
        >
          {formatClock(remainingMs)}
        </Text>
        <Pressable
          onPress={() => setMatrixOpen(true)}
          accessibilityRole="button"
          testID="exam-matrix-open"
          className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-2 active:bg-surface-2"
        >
          <Ionicons name="grid-outline" size={15} color={tokens.accent} />
          <Text className="font-ui-medium text-sm text-accent">Матрица</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-6 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="caption" className="px-1" testID="part-instructions">
          {part.instructions.ru}
        </Text>
        {examAudio && group.audioKey !== null ? (
          <ListeningPlayer
            key={group.audioKey}
            audio={examAudio.audio!}
            mode="exam"
            answered={false}
            storyId={examAudio.audioStoryId ?? ''}
            maxPlays={subtest.audioPlays ?? 2}
            examPlay={{
              playNo,
              phase: run.audio.key === group.audioKey ? run.audio.phase : 'idle',
            }}
            onEnded={onAudioEnded}
          />
        ) : null}
        {itemsOfView.map(({ item, number, partIdx, itemIdx }) => (
          <MockItem
            key={item.id}
            packId={packId}
            level={level}
            subtest={subtest}
            item={item}
            number={number}
            part={subtest.parts[partIdx]!}
            itemIdx={itemIdx}
            answer={run.answers[item.id]}
            flagged={run.flagged.includes(item.id)}
            lookup={lookup}
            showHeader={itemsOfView.length > 1}
            onAnswer={(a) => onAnswer(item.id, a)}
            onFlag={() => onFlag(item.id)}
            onLookup={onLookup}
          />
        ))}
      </ScrollView>

      {/* bottom navigation */}
      <View
        className="flex-row items-center gap-3 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        {linear ? (
          <>
            <Text variant="caption" className="flex-1">
              Назад нельзя
            </Text>
            <Pressable
              onPress={lastGroup ? () => setMatrixOpen(true) : onNext}
              accessibilityRole="button"
              testID="exam-next"
              className="flex-row items-center gap-2 rounded-full bg-accent px-6 py-3 active:opacity-80"
            >
              <Text className="font-ui-bold text-bg">{lastGroup ? 'Закончить' : 'Дальше'}</Text>
              <Ionicons name="chevron-forward" size={16} color={tokens.bg} />
            </Pressable>
          </>
        ) : (
          <>
            <NavButton
              icon="chevron-back"
              label="Предыдущее задание"
              disabled={flat === 0}
              onPress={() => onGoto(flat - 1)}
              testID="exam-prev"
            />
            <View className="flex-1 items-center">
              <Text variant="caption">
                {flat + 1} / {layout.items.length}
              </Text>
            </View>
            {flat === layout.items.length - 1 ? (
              <Pressable
                onPress={() => setMatrixOpen(true)}
                accessibilityRole="button"
                testID="exam-finish-open"
                className="rounded-full bg-accent px-5 py-3 active:opacity-80"
              >
                <Text className="font-ui-bold text-bg">Закончить</Text>
              </Pressable>
            ) : (
              <NavButton
                icon="chevron-forward"
                label="Следующее задание"
                onPress={() => onGoto(flat + 1)}
                testID="exam-forward"
              />
            )}
          </>
        )}
      </View>

      <ExamMatrixSheet
        open={matrixOpen}
        cells={cells}
        linear={linear}
        onJump={onGoto}
        onSubmit={() => {
          setMatrixOpen(false);
          onSubmit();
        }}
        onClose={() => setMatrixOpen(false)}
      />
    </View>
  );
}

function NavButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      className={cn(
        'h-12 w-14 items-center justify-center rounded-full border border-border',
        disabled ? 'opacity-30' : 'active:bg-surface-2',
      )}
    >
      <Ionicons name={icon} size={20} color={tokens.text} />
    </Pressable>
  );
}

/** One item in a mock: the (reading) passage, the kind's no-feedback view, the ⚑ toggle. */
function MockItem({
  packId,
  level,
  subtest,
  item,
  number,
  part,
  itemIdx,
  answer,
  flagged,
  lookup,
  showHeader,
  onAnswer,
  onFlag,
  onLookup,
}: {
  packId: string;
  level: TorflLevel;
  subtest: ExamSubtest;
  item: ExamItem;
  number: number;
  part: ExamSubtest['parts'][number];
  itemIdx: number;
  answer: ExamAnswer | undefined;
  flagged: boolean;
  lookup: boolean;
  showHeader: boolean;
  onAnswer: (answer: ExamAnswer) => void;
  onFlag: () => void;
  onLookup: () => void;
}) {
  const { tokens } = useAppTheme();
  const passage = useMockPassage(packId, part, itemIdx, item, subtest.kind === 'reading');
  if (item.kind !== 'choice' && item.kind !== 'typed') return null;
  return (
    <View className="gap-3" testID={`mock-item-${item.id}`}>
      <View className="flex-row items-center justify-between px-1">
        {showHeader ? <Text className="font-ui-bold">Задание {number}</Text> : <View />}
        <Pressable
          onPress={onFlag}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ selected: flagged }}
          accessibilityLabel={flagged ? 'Снять флажок' : 'Поставить флажок'}
          testID={`flag-${item.id}`}
          className={cn(
            'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
            flagged ? 'border-track-warm bg-track-warm-soft' : 'border-border',
          )}
        >
          <Ionicons
            name={flagged ? 'flag' : 'flag-outline'}
            size={14}
            color={flagged ? tokens.trackWarm : tokens.textMuted}
          />
          <Text
            className={cn(
              'text-xs font-ui-medium',
              flagged ? 'text-track-warm' : 'text-text-muted',
            )}
          >
            флажок
          </Text>
        </Pressable>
      </View>
      {passage === 'loading' ? (
        <ActivityIndicator color={tokens.accent} />
      ) : passage ? (
        <PassagePanel
          packId={packId}
          storyId={passage.storyId}
          sentences={passage.sentences}
          lookup={lookup}
          subtestKind={subtest.kind}
          level={level}
          onLookup={onLookup}
        />
      ) : null}
      {item.kind === 'choice' ? (
        <ChoiceItemView
          item={item as ChoiceItem}
          feedback="none"
          initialIndex={answer?.kind === 'choice' ? answer.index : null}
          onAnswer={(index) => onAnswer({ kind: 'choice', index })}
        />
      ) : (
        <TypedItemView
          item={item as TypedItem}
          feedback="none"
          initialText={answer?.kind === 'typed' ? answer.text : ''}
          onSubmit={(text) => onAnswer({ kind: 'typed', text })}
        />
      )}
    </View>
  );
}

/**
 * Reading passage of an item, the WHOLE story (a candidate reads the full
 * text; drills' sentence-range refs are practice granularity). `null` when
 * the item has none; `'loading'` while the story loads.
 */
function useMockPassage(
  packId: string,
  part: ExamSubtest['parts'][number],
  itemIdx: number,
  item: ExamItem,
  enabled: boolean,
): ExamPassage | 'loading' | null {
  const storyId =
    enabled && (item.kind === 'choice' || item.kind === 'typed')
      ? item.passage?.storyId
      : undefined;
  const [loaded, setLoaded] = React.useState<{
    storyId: string;
    passage: ExamPassage | null;
  } | null>(null);
  React.useEffect(() => {
    if (!storyId || (item.kind !== 'choice' && item.kind !== 'typed')) return;
    let cancelled = false;
    const whole = { ...item, passage: { storyId } } as ExamItem;
    void loadItemAssets(repos.content, packId, part, itemIdx, whole, fileExists)
      .catch(() => ({ passage: null, audio: null, audioStoryId: null }) as ItemAssets)
      .then((a) => {
        if (!cancelled) setLoaded({ storyId, passage: a.passage });
      });
    return () => {
      cancelled = true;
    };
    // item identity is stable per render of a given item id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, storyId, item.id]);
  if (!storyId) return null;
  if (!loaded || loaded.storyId !== storyId) return 'loading';
  return loaded.passage;
}
