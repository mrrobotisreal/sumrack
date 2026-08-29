import type { ExerciseSpec } from '@sumrak/schema';
import * as React from 'react';
import { Alert, BackHandler } from 'react-native';

import { SessionShell } from '@/features/review/session-shell';
import { track, type AnalyticsEvent } from '@/services/analytics';

import type { SpecOutcome } from './scoring';
import { SpecListeningView } from './spec-listening-view';
import { SpecPronunciationView } from './spec-pronunciation-view';
import { SpecClozeView, SpecMcView, SpecSbView } from './spec-views';

interface ExerciseRunnerProps {
  specs: ExerciseSpec[];
  /** Analytics event prefix: 'unit_quiz' | 'checkpoint'. */
  trackPrefix: 'unit_quiz' | 'checkpoint';
  onQuit: () => void;
  onFinish: (outcomes: SpecOutcome[], durationMs: number) => void;
  /** T31: let a host-owned ambient scene show through (unit quiz only). */
  transparentBg?: boolean;
}

/**
 * ONE engine for authored tests (T17): serves an `ExerciseSpec[]` — a
 * checkpoint's authored specs or a unit quiz's generated ones — inside the
 * shared SessionShell chrome. Quitting mid-test discards it (a test is
 * all-or-nothing, unlike reviews where every grade persists immediately);
 * the quit confirm says so.
 */
export function ExerciseRunner({
  specs,
  trackPrefix,
  onQuit,
  onFinish,
  transparentBg = false,
}: ExerciseRunnerProps) {
  const [index, setIndex] = React.useState(0);
  const outcomesRef = React.useRef<SpecOutcome[]>([]);
  const startedAtRef = React.useRef(0);
  const itemShownAtRef = React.useRef(0);
  const doneRef = React.useRef(false);
  React.useEffect(() => {
    startedAtRef.current = Date.now();
    itemShownAtRef.current = Date.now();
  }, []);

  const advance = React.useCallback(
    (outcome: { correct: boolean; skipped: boolean }) => {
      const spec = specs[index]!;
      outcomesRef.current.push({
        specId: spec.id,
        kind: spec.kind,
        correct: outcome.correct,
        skipped: outcome.skipped,
        durationMs: Date.now() - itemShownAtRef.current,
      });
      track(`${trackPrefix}_item_answered` as AnalyticsEvent, {
        kind: spec.kind,
        correct: outcome.correct,
        skipped: outcome.skipped,
      });
      const next = index + 1;
      if (next < specs.length) {
        itemShownAtRef.current = Date.now();
        setIndex(next);
        return;
      }
      if (doneRef.current) return;
      doneRef.current = true;
      onFinish(outcomesRef.current, Date.now() - startedAtRef.current);
    },
    [index, specs, trackPrefix, onFinish],
  );

  const quit = React.useCallback(() => {
    Alert.alert('Leave the test?', 'This attempt will not be scored.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          track(`${trackPrefix}_abandoned` as AnalyticsEvent, {
            completed: outcomesRef.current.length,
            total: specs.length,
          });
          onQuit();
        },
      },
    ]);
  }, [trackPrefix, specs.length, onQuit]);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [quit]);

  const spec = specs[index]!;
  return (
    <SessionShell current={index} total={specs.length} onQuit={quit} transparentBg={transparentBg}>
      {spec.kind === 'multiple-choice' && (
        <SpecMcView
          key={spec.id}
          spec={spec}
          onDone={(correct) => advance({ correct, skipped: false })}
        />
      )}
      {spec.kind === 'cloze' && (
        <SpecClozeView
          key={spec.id}
          spec={spec}
          onDone={(correct) => advance({ correct, skipped: false })}
        />
      )}
      {spec.kind === 'sentence-builder' && (
        <SpecSbView
          key={spec.id}
          spec={spec}
          onDone={(correct) => advance({ correct, skipped: false })}
        />
      )}
      {spec.kind === 'listening' && (
        <SpecListeningView
          key={spec.id}
          spec={spec}
          onDone={(correct) => advance({ correct, skipped: false })}
        />
      )}
      {spec.kind === 'pronunciation' && (
        <SpecPronunciationView
          key={spec.id}
          spec={spec}
          onDone={(correct) => advance({ correct, skipped: false })}
          onSkip={() => advance({ correct: false, skipped: true })}
        />
      )}
    </SessionShell>
  );
}
