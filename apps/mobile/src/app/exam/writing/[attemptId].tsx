import { useLocalSearchParams } from 'expo-router';

import { WritingReviewScreen } from '@/features/torfl/writing/writing-review-screen';

/** Writing review route (T72): `/exam/writing/<attemptId>` — the letter, criteria, corrections, self-check. */
export default function ExamWritingReviewRoute() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <WritingReviewScreen attemptId={attemptId} />;
}
