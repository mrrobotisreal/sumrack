import { useLocalSearchParams } from 'expo-router';

import { ExamResultsScreen } from '@/features/torfl/exam-results-screen';

/** Mock results route (T71): `/exam/results/<attemptId>`. */
export default function ExamResultsRoute() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <ExamResultsScreen attemptId={attemptId} />;
}
