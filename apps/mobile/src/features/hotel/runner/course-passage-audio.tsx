import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { fileExists } from '@/features/torfl/drill/drill-item';
import { loadItemAssets, type ItemAssets } from '@/features/torfl/items/exam-audio';
import { ListeningPlayer } from '@/features/torfl/items/listening-player';
import { PassagePanel } from '@/features/torfl/items/passage-panel';
import { useAppTheme } from '@/theme/use-app-theme';

import type { DrillEntry } from '@/features/torfl/drill/drill-model';

import type { RunMode } from './runner-model';
import { maxPlaysFor } from './skill-items';

/**
 * The floor-14 passage and audio above a choice / typed item in a course run
 * (T92d, decision 8). The assets come from the same resolver as the exam drill
 * (`loadItemAssets`, one-item part from `courseDrillEntry`), so a course item
 * plays and reads exactly as its exam twin does. Practice (unit) has no play
 * limit; a floor exam or экстерн allows 2 plays per audio.
 */
export function CoursePassageAudio({
  entry,
  mode,
  answered,
}: {
  entry: DrillEntry;
  mode: RunMode;
  /** The item has been answered (a transcript may open in unit practice). */
  answered: boolean;
}) {
  const { tokens } = useAppTheme();
  const [assets, setAssets] = React.useState<ItemAssets | null>(null);

  // Keyed on the item id, not the entry object (rebuilt each render): assets load once per item.
  const itemId = entry.item.id;
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
        if (!cancelled) setAssets(loaded);
      });
    return () => {
      cancelled = true;
    };
    // The entry is rebuilt per render; the item id is the identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (!assets) {
    return (
      <View className="items-center py-3">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!assets.passage && !assets.audio) return null;

  return (
    <View className="gap-3">
      {assets.passage ? (
        <PassagePanel
          packId={entry.packId}
          storyId={assets.passage.storyId}
          sentences={assets.passage.sentences}
          lookup
          level={entry.level}
        />
      ) : null}
      {assets.audio ? (
        <ListeningPlayer
          audio={assets.audio}
          mode="drill"
          answered={answered}
          storyId={assets.audioStoryId ?? ''}
          maxPlays={maxPlaysFor(mode)}
        />
      ) : (
        <Text variant="caption">Аудио для этого задания не найдено.</Text>
      )}
    </View>
  );
}
