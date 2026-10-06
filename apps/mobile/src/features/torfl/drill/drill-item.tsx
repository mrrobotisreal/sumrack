import type { ChoiceItem, TypedItem } from '@sumrak/schema';
import { File } from 'expo-file-system';
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useAppTheme } from '@/theme/use-app-theme';

import { ChoiceItemView } from '../items/choice-item-view';
import { ExplainCard } from '../items/explain-card';
import { loadItemAssets, type ItemAssets } from '../items/exam-audio';
import { ListeningPlayer } from '../items/listening-player';
import { PassagePanel } from '../items/passage-panel';
import { TypedItemView } from '../items/typed-item-view';
import { scoreChoice, scoreTyped, type ItemScore } from '../scoring';
import { Badge } from '../items/stem-text';
import type { DrillEntry } from './drill-model';
import type { ExamScoreArgs } from './types';
import { topicLabel } from '../topics';

export type DrillAnswerPayload = { index: number | null } | { text: string };

/** Local-file existence for audio tracks (drills fall back to TTS when a file is gone). */
export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * One drill item, end to end (T70): loads its passage / audio, renders the
 * kind's view with INSTANT feedback, scores through `scoring.ts`, reports the
 * answer (`onAnswered` — the host records it), then shows the explain card
 * and calls `onNext`. Shared by the drill runner and the daily-session
 * `torfl` segment, so both feel identical.
 */
export function DrillItem({
  entry,
  last,
  onAnswered,
  onNext,
}: {
  entry: DrillEntry;
  last: boolean;
  onAnswered: (args: ExamScoreArgs) => void;
  onNext: () => void;
}) {
  const { tokens } = useAppTheme();
  const [assets, setAssets] = React.useState<ItemAssets | null>(null);
  const [score, setScore] = React.useState<ItemScore | null>(null);
  const shownAtRef = React.useRef(0);
  const doneRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void loadItemAssets(
      repos.content,
      entry.packId,
      entry.part,
      entry.itemIdx,
      entry.item,
      fileExists,
    )
      .catch(() => ({ passage: null, audio: null, audioStoryId: null }) as ItemAssets)
      .then((loaded) => {
        if (cancelled) return;
        setAssets(loaded);
        shownAtRef.current = Date.now();
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const finish = React.useCallback(
    (answer: DrillAnswerPayload, s: ItemScore) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setScore(s);
      onAnswered({ answer, score: s, ms: Date.now() - shownAtRef.current });
    },
    [onAnswered],
  );

  if (!assets) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  const { item, subtest } = entry;
  const max = subtest.pointsPerItem ?? 1;
  const answered = score !== null;
  const needsAudio = entry.subtest.kind === 'listening';

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-4"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center gap-2">
        <Badge label={topicLabel(item.topic).ru} />
      </View>
      {assets.passage && (
        <PassagePanel
          packId={entry.packId}
          storyId={assets.passage.storyId}
          sentences={assets.passage.sentences}
          lookup
        />
      )}
      {needsAudio &&
        (assets.audio ? (
          <ListeningPlayer
            audio={assets.audio}
            mode="drill"
            answered={answered}
            storyId={assets.audioStoryId ?? ''}
            autoPlay
          />
        ) : (
          <Text variant="caption">Аудио для этого задания не найдено.</Text>
        ))}
      {item.kind === 'choice' ? (
        <ChoiceItemView
          item={item as ChoiceItem}
          feedback="instant"
          showStemEn
          onAnswer={(index) => finish({ index }, scoreChoice(item as ChoiceItem, index, max))}
        />
      ) : (
        <TypedItemView
          item={item as TypedItem}
          feedback="instant"
          result={score}
          onSubmit={(text) => finish({ text }, scoreTyped(item as TypedItem, text, max))}
        />
      )}
      {answered && (
        <ExplainCard outcome={score.outcome} explain={item.explain} last={last} onNext={onNext} />
      )}
    </ScrollView>
  );
}
