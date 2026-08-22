import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useGamePrefs } from '@/store/game-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { sbOutcomeToRating, type SbOutcome } from '../../mapping';
import { SessionShell } from '../../session-shell';
import { SummaryView } from '../../summary-view';
import { useGameSession } from '../use-game-session';
import { SbView } from './sb-view';
import { buildSbSession, type SbItem } from './session';

/**
 * The standalone sentence-builder session (T13, design §7.3 mode 4),
 * launched from the games menu. Same read-stories-only sourcing as cloze.
 */
export function SbSessionScreen() {
  const { tokens } = useAppTheme();
  const unseenAllowed = useGamePrefs((s) => s.clozeUnseenStoriesAllowed);
  // Captured once at mount — the session is built once; a settings change applies next launch.
  const [build] = React.useState(() => () => buildSbSession(repos, { unseenAllowed }));

  const session = useGameSession<SbItem>({
    mode: 'sentence-builder',
    trackPrefix: 'sb',
    resultMode: 'sentence-builder',
    build,
  });

  const onDone = React.useCallback(
    (entry: SbItem, outcome: SbOutcome) => {
      session.grade(entry.card, sbOutcomeToRating(outcome), {
        removals: outcome.removals,
        wordCount: outcome.wordCount,
        distractors: entry.tiles.filter((t) => t.distractor).length,
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
        <Text className="font-reading text-xl">Нет предложений</Text>
        <Text variant="muted" className="text-center">
          Sentence builder rebuilds short sentences from stories you&apos;ve read that contain your
          saved words. Read a story and collect words — or allow unread stories in Settings → Games.
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
      <SbView key={entry.card.id} entry={entry} onDone={(outcome) => onDone(entry, outcome)} />
    </SessionShell>
  );
}
