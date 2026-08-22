import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useGamePrefs } from '@/store/game-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { listeningOutcomeToRating, type ListeningOutcome } from '../../mapping';
import { SessionShell } from '../../session-shell';
import { SummaryView } from '../../summary-view';
import { useGameSession } from '../use-game-session';
import { ListeningView } from './listening-view';
import { buildListeningSession, type ListeningItem } from './session';

/**
 * The standalone listening-quiz session (T14, design §7.3 mode 5), launched
 * from the games menu. Fully offline: pack narration segments when stamps
 * cover the item, on-device TTS otherwise.
 */
export function ListeningSessionScreen() {
  const { tokens } = useAppTheme();
  const unseenAllowed = useGamePrefs((s) => s.clozeUnseenStoriesAllowed);
  // Captured once at mount — the session is built once; a settings change applies next launch.
  const [build] = React.useState(() => () => buildListeningSession(repos, { unseenAllowed }));

  const session = useGameSession<ListeningItem>({
    mode: 'listening',
    trackPrefix: 'listening',
    resultMode: 'listening',
    build,
  });

  const onDone = React.useCallback(
    (entry: ListeningItem, outcome: ListeningOutcome) => {
      session.grade(entry.card, listeningOutcomeToRating(outcome), {
        variant: outcome.variant,
        source: entry.audio.kind,
        replays: outcome.replays,
        slowReplays: outcome.slowReplays,
        durationMs: outcome.durationMs,
      });
    },
    [session],
  );

  if (session.phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (session.phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-reading text-xl">Нечего слушать</Text>
        <Text variant="muted" className="text-center">
          The listening quiz plays words from your bank. Read a story and collect some words first.
        </Text>
        <Pressable
          onPress={() => session.router.back()}
          accessibilityRole="button"
          className="mt-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (session.phase === 'summary') {
    return <SummaryView results={session.finalResults} onDone={() => session.router.back()} />;
  }

  const entry = session.entry!;
  return (
    <SessionShell current={session.index} total={session.items.length} onQuit={session.quit}>
      <ListeningView key={entry.card.id} entry={entry} onDone={(o) => onDone(entry, o)} />
    </SessionShell>
  );
}
