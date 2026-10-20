import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { AttemptSchema } from './attempt';
import { catalog } from './catalog';
import { useLabHistory } from './lab-hooks';
import { LabButton, LabHeader } from './lab-ui';

export function ListeningLabScreen() {
  const router = useRouter(),
    insets = useSafeAreaInsets(),
    { tokens } = useAppTheme();
  const history = useLabHistory();
  const [opened, setOpened] = React.useState<string | null>(null);
  React.useEffect(() => {
    track('listening_lab_opened');
  }, []);
  const saved = (history.data ?? []).flatMap((r) => {
    const attempt = AttemptSchema.safeParse(r.detail);
    return attempt.success ? [{ row: r, attempt: attempt.data }] : [];
  });
  return (
    <View className="flex-1 bg-bg">
      <LabHeader title="Listening lab" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
        <View className="gap-3 pb-6">
          <Text variant="reading">Сначала слушай.</Text>
          <Text variant="muted">
            Listen, find the meaning, dictate, then compare and retell. Each stage can be used on
            its own.
          </Text>
          <Text variant="caption">
            20 short A1/A2 practice clips. Narration must be downloaded. Sentence text and timing
            were checked against the source; human listening checks are still pending.
          </Text>
        </View>
        {(['A1', 'A2'] as const).map((level) => (
          <View key={level} className="mb-7 gap-2">
            <Text variant="title" className="mb-2" accessibilityRole="header">
              {level} · Everyday dialogue
            </Text>
            {catalog.segments
              .filter((s) => s.level === level)
              .map((segment, i) => {
                const count = saved.filter((s) => s.attempt.segmentId === segment.id).length;
                return (
                  <LabButton
                    key={segment.id}
                    onPress={() => router.push(`/listening-lab/${segment.id}`)}
                  >
                    {`Clip ${i + 1} · ${Math.ceil((segment.source.endMs - segment.source.startMs) / 1000)} sec${count ? ` · ${count} saved attempt${count === 1 ? '' : 's'}` : ''}`}
                  </LabButton>
                );
              })}
          </View>
        ))}
        <Text variant="title" accessibilityRole="header">
          Saved attempts
        </Text>
        <Text variant="caption" className="mb-3 mt-2">
          Completed text and results are included in your app backup and sync. Temporary recordings
          are not retained.
        </Text>
        {history.isPending ? (
          <ActivityIndicator color={tokens.accent} />
        ) : history.isError ? (
          <LabButton onPress={() => void history.refetch()}>Retry attempt history</LabButton>
        ) : saved.length === 0 ? (
          <Text variant="muted">Finish any stage and save it to start your history.</Text>
        ) : (
          saved.slice(0, 10).map(({ row, attempt }) => (
            <View key={row.id} className="mb-3 gap-2">
              <LabButton
                onPress={() => setOpened(opened === row.id ? null : row.id)}
              >{`${attempt.segmentId} · ${new Date(row.endedAt ?? row.startedAt).toLocaleDateString()} · ${attempt.priorExposures > 0 ? 'repeat practice' : 'first saved lab attempt'}`}</LabButton>
              {opened === row.id ? (
                <View className="gap-2 px-2 py-2">
                  {attempt.meaning ? (
                    <Text>
                      Meaning: {attempt.meaning.correct ? 'correct' : 'try again'} ·{' '}
                      {attempt.meaning.firstLabListen
                        ? 'first lab listen (earlier exposure unknown)'
                        : 'supported or repeated'}
                    </Text>
                  ) : null}
                  {attempt.dictation ? (
                    <>
                      <Text variant="caption">
                        Your dictation ·{' '}
                        {attempt.dictation.correct ? 'matches' : 'differences found'}
                      </Text>
                      <Text variant="reading" selectable>
                        {attempt.dictation.response}
                      </Text>
                    </>
                  ) : null}
                  {attempt.retelling ? (
                    <>
                      <Text variant="caption">Your retelling · self-review</Text>
                      <Text variant="reading" selectable>
                        {attempt.retelling}
                      </Text>
                    </>
                  ) : null}
                  <Text variant="caption">
                    {attempt.assistance.plays} plays · {attempt.assistance.slowPlays} slow ·{' '}
                    {attempt.assistance.help} help ·{' '}
                    {attempt.yoPolicy === 'strict' ? 'ё is tested' : 'е/ё accepted'}
                  </Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
