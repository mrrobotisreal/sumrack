import { useLocalSearchParams } from 'expo-router';

import { ExamReviewScreen } from '@/features/torfl/exam-review-screen';

/** Mock item review route (T71): `/exam/review/<attemptId>` (only after the attempt is finished). */
export default function ExamReviewRoute() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <ExamReviewScreen attemptId={attemptId} />;
}
