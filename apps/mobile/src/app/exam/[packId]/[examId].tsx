import { useLocalSearchParams } from 'expo-router';

import { ExamIntroScreen } from '@/features/torfl/exam-intro-screen';

/**
 * Exam intro route (T69). The start handlers stay unset until T70 (drills)
 * and T71 (mocks) pass them here — the intro renders «скоро» meanwhile.
 */
export default function ExamIntroRoute() {
  const { packId, examId } = useLocalSearchParams<{ packId: string; examId: string }>();
  return <ExamIntroScreen packId={packId} examId={examId} />;
}
