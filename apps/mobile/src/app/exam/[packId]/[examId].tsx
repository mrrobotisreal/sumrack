import { useLocalSearchParams, useRouter } from 'expo-router';

import { ExamIntroScreen } from '@/features/torfl/exam-intro-screen';
import { drillHref } from '@/features/torfl/drill/drill-model';

/**
 * Exam intro route (T69). T70 wires the DRILL start (the drill runner at
 * `/torfl/drill`); the mock start stays unset until T71 — the intro renders
 * «скоро» on a mock's button meanwhile.
 */
export default function ExamIntroRoute() {
  const router = useRouter();
  const { packId, examId } = useLocalSearchParams<{ packId: string; examId: string }>();
  return (
    <ExamIntroScreen
      packId={packId}
      examId={examId}
      onStartDrill={(exam, pack) =>
        router.push(drillHref({ source: 'set', packId: pack, examId: exam.id }))
      }
    />
  );
}
