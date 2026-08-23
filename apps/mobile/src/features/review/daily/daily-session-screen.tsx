import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useDailyPrefs } from '@/store/daily-prefs';
import { useGamePrefs } from '@/store/game-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { FlashcardView } from '../flashcard-view';
import {
  clozeOutcomeToRating,
  listeningOutcomeToRating,
  mcOutcomeToRating,
  ratingCountsAsCorrect,
  sbOutcomeToRating,
} from '../mapping';
import { McView } from '../mc-view';
import { SessionShell } from '../session-shell';
import { SummaryView } from '../summary-view';
import { ClozeView } from '../games/cloze/cloze-view';
import { ListeningView } from '../games/listening/listening-view';
import { SbView } from '../games/sentence-builder/sb-view';
import { useGameSession } from '../games/use-game-session';
import { buildDailySession, dailyItemCard, type DailyItem } from './session';

/**
 * The unified daily session (T14) — Today's default "Start session" action.
 * One flow over the due queue through a weighted mix of all five
 * implemented modes; each item grades through its own mode's rating
 * mapping into the same FSRS pipeline. Composition honors the Settings
 * weights/length and T13's unseen-stories toggle.
 */
export function DailySessionScreen() {
  const { tokens } = useAppTheme();
  const unseenAllowed = useGamePrefs((s) => s.clozeUnseenStoriesAllowed);
  const prefs = useDailyPrefs((s) => s.prefs);
  // T18 "practice now": `focus` = comma-joined bank item ids — the session
  // narrows to those items' cards (due-agnostic) instead of the due queue.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  // Captured once at mount — the session builds once; settings apply next launch.
  const [build] = React.useState(
    () => () =>
      buildDailySession(repos, {
        length: prefs.length,
        weights: prefs.weights,
        unseenAllowed,
        focusItemIds: focus ? focus.split(',').filter(Boolean) : undefined,
      }),
  );

  const session = useGameSession<DailyItem>({
    mode: 'review-daily',
    trackPrefix: 'daily',
    resultMode: 'flashcard',
    build,
  });

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
        <Text className="font-reading text-xl">Всё повторено</Text>
        <Text variant="muted" className="text-center">
          Nothing is due right now. Read something — new words become reviews.
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
    return (
      <SummaryView
        results={session.finalResults}
        durationMs={session.finalDurationMs}
        onDone={() => session.router.back()}
      />
    );
  }

  const item = session.entry!;
  const card = dailyItemCard(item);
  return (
    <SessionShell current={session.index} total={session.items.length} onQuit={session.quit}>
      {item.mode === 'flashcard' && (
        <FlashcardView
          key={card.id}
          entry={item.entry}
          onGrade={(rating, durationMs) =>
            session.grade(
              card,
              rating,
              { durationMs, correct: ratingCountsAsCorrect(rating) },
              'flashcard',
            )
          }
        />
      )}
      {item.mode === 'mc' && (
        <McView
          key={card.id}
          entry={item.entry}
          onAnswer={(correct, durationMs) =>
            session.grade(
              card,
              mcOutcomeToRating(correct, durationMs),
              { durationMs, correct },
              'mc',
            )
          }
        />
      )}
      {item.mode === 'cloze' && (
        <ClozeView
          key={card.id}
          entry={item.entry}
          onDone={(outcome) =>
            session.grade(
              card,
              clozeOutcomeToRating(outcome),
              {
                variant: outcome.variant,
                hintsUsed: outcome.hintsUsed,
                revealed: outcome.revealed,
                durationMs: outcome.durationMs,
              },
              'cloze',
            )
          }
        />
      )}
      {item.mode === 'sentence-builder' && (
        <SbView
          key={card.id}
          entry={item.entry}
          onDone={(outcome) =>
            session.grade(
              card,
              sbOutcomeToRating(outcome),
              {
                removals: outcome.removals,
                wordCount: outcome.wordCount,
                durationMs: outcome.durationMs,
              },
              'sentence-builder',
            )
          }
        />
      )}
      {item.mode === 'listening' && (
        <ListeningView
          key={card.id}
          entry={item.entry}
          onDone={(outcome) =>
            session.grade(
              card,
              listeningOutcomeToRating(outcome),
              {
                variant: outcome.variant,
                source: item.entry.audio.kind,
                replays: outcome.replays,
                slowReplays: outcome.slowReplays,
                durationMs: outcome.durationMs,
              },
              'listening',
            )
          }
        />
      )}
    </SessionShell>
  );
}
