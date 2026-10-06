import type { Exam } from '@sumrak/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Alert } from 'react-native';

import { repos } from '@/db';
import { invalidateExams } from '@/db/hooks';
import { ExamAttemptActiveError } from '@/db/repositories/exams';
import { drillHref } from '@/features/torfl/drill/drill-model';
import { startMockAttempt } from '@/features/torfl/engine/start';
import { ExamIntroScreen, type ExamStartScope } from '@/features/torfl/exam-intro-screen';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

/**
 * Exam intro route (T69 + T70 drills + T71 mocks). A mock start creates the
 * attempt (single-active rule) and opens the full-screen runner; an existing
 * active attempt offers «Продолжить» / «Начать заново» (the latter abandons).
 */
export default function ExamIntroRoute() {
  const router = useRouter();
  const { packId, examId } = useLocalSearchParams<{ packId: string; examId: string }>();

  const open = React.useCallback(
    (attemptId: string) =>
      router.push({ pathname: '/exam/run/[attemptId]', params: { attemptId } }),
    [router],
  );

  const begin = React.useCallback(
    async (exam: Exam, pack: string, scope: ExamStartScope, replace: boolean) => {
      if (scope.scope === 'drill') return;
      try {
        const attempt = await startMockAttempt(repos.exams, exam, pack, scope, { replace });
        void invalidateExams();
        track('exam_started', {
          packId: pack,
          examId: exam.id,
          scope: scope.scope,
          ...(scope.scope === 'subtest'
            ? { subtestKind: exam.subtests.find((s) => s.id === scope.subtestId)?.kind ?? 'none' }
            : {}),
        });
        open(attempt.id);
      } catch (err) {
        if (err instanceof ExamAttemptActiveError) {
          Alert.alert(
            'Есть незаконченная попытка',
            'Сначала закончи её или начни новую — старая будет прервана.',
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Продолжить её', onPress: () => open(err.activeAttemptId) },
              {
                text: 'Начать заново',
                style: 'destructive',
                onPress: () => void begin(exam, pack, scope, true),
              },
            ],
          );
          return;
        }
        logError('manual', err);
        Alert.alert('Не удалось начать экзамен', 'Попробуй ещё раз.');
      }
    },
    [open],
  );

  return (
    <ExamIntroScreen
      packId={packId}
      examId={examId}
      onStartDrill={(exam, pack) =>
        router.push(drillHref({ source: 'set', packId: pack, examId: exam.id }))
      }
      onStartMock={(exam, pack, scope) => void begin(exam, pack, scope, false)}
      onResumeMock={open}
      onRestartMock={(exam, pack, scope) => void begin(exam, pack, scope, true)}
    />
  );
}
