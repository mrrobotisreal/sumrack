import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { recordExamDeckSession } from '@/features/motivation/service';
import { DrillItem } from '@/features/torfl/drill/drill-item';
import { createDrillRecorder, type DrillRecorder } from '@/features/torfl/drill/drill-recorder';
import type { TorflLevel } from '@/features/torfl/level-profile';
import { levelOrder } from '@/features/torfl/levels-today';
import { getExamDates } from '@/features/torfl/settings';
import { track, trackTorfl } from '@/services/analytics';
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
import {
  buildDailySession,
  buildTorflSegment,
  dailyItemCard,
  type DailyItem,
  type DailyTorflItem,
} from './session';
import { torflSegmentEnabled } from './prefs';

/** The daily session serves card items, then (M18, T70) the TORFL deck block. */
type ScreenItem = DailyItem | DailyTorflItem;

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
  const [build] = React.useState(() => async (): Promise<ScreenItem[]> => {
    const focusItemIds = focus ? focus.split(',').filter(Boolean) : undefined;
    const cards = await buildDailySession(repos, {
      length: prefs.length,
      weights: prefs.weights,
      unseenAllowed,
      focusItemIds,
    });
    // M18 (T70): the optional TORFL block — default on iff an exam date is set; never in a focused session.
    if (focusItemIds) return cards;
    const dates = await getExamDates();
    if (!torflSegmentEnabled(prefs, dates)) return cards;
    const segment = await buildTorflSegment(repos, { levels: levelOrder(dates) });
    if (segment.length > 0) {
      track('daily_torfl_segment', {
        items: segment.length,
        a1Items: segment.filter((s) => s.entry.level === 'A1').length,
        a2Items: segment.filter((s) => s.entry.level === 'A2').length,
      });
    }
    return [...cards, ...segment];
  });

  // --- the TORFL block's own recorder (deck cards, not `cards`) ---------------
  const recorderRef = React.useRef<DrillRecorder | null>(null);
  const torflAnsweredRef = React.useRef(0);
  /** T75: answered deck items per level — `exam_deck_reviewed` reports the level with most of them. */
  const torflAnsweredByLevelRef = React.useRef<Record<TorflLevel, number>>({ A1: 0, A2: 0 });
  const torflClosedRef = React.useRef(false);
  const getRecorder = () => (recorderRef.current ??= createDrillRecorder(repos.exams));

  const session = useGameSession<ScreenItem>({
    mode: 'review-daily',
    trackPrefix: 'daily',
    resultMode: 'flashcard',
    build,
  });

  const phase = session.phase;
  React.useEffect(() => {
    if (phase !== 'summary' || torflClosedRef.current || torflAnsweredRef.current === 0) return;
    torflClosedRef.current = true;
    void (async () => {
      try {
        await getRecorder().finish();
        await recordExamDeckSession();
        const byLevel = torflAnsweredByLevelRef.current;
        // The level with most answers (ties → A1, the fixed order).
        const level: TorflLevel = byLevel.A2 > byLevel.A1 ? 'A2' : 'A1';
        trackTorfl('exam_deck_reviewed', {
          due: torflAnsweredRef.current,
          reviewed: torflAnsweredRef.current,
          level,
          a1Reviewed: byLevel.A1,
          a2Reviewed: byLevel.A2,
        });
      } catch (err) {
        console.warn('[daily] torfl wrap-up failed', err);
      }
    })();
  }, [phase]);
  React.useEffect(
    () => () => {
      if (!torflClosedRef.current && recorderRef.current) {
        torflClosedRef.current = true;
        void recorderRef.current.abandon();
      }
    },
    [],
  );

  if (session.phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (session.phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError
          message="Couldn't build this session — something went wrong reading the database."
          onRetry={session.retry}
        />
        <Pressable
          onPress={() => session.router.back()}
          accessibilityRole="button"
          className="min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
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
  if (item.mode === 'torfl') {
    return (
      <SessionShell current={session.index} total={session.items.length} onQuit={session.quit}>
        <DrillItem
          key={item.entry.itemKey}
          entry={item.entry}
          last={session.index === session.items.length - 1}
          onAnswered={(args) => {
            torflAnsweredRef.current += 1;
            torflAnsweredByLevelRef.current[item.entry.level] += 1;
            trackTorfl('exam_drill_item_answered', {
              subtestKind: item.entry.subtest.kind,
              topic: item.entry.item.topic,
              correct: args.score.outcome === 'full',
              ms: Math.round(args.ms),
              level: item.entry.level,
            });
            void getRecorder()
              .answer(item.entry, args.answer, args.score, args.ms)
              .catch((err) => console.warn('[daily] torfl answer failed', err));
          }}
          onNext={session.advance}
        />
      </SessionShell>
    );
  }
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
