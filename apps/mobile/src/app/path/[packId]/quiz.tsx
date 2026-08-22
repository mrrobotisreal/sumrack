import { useLocalSearchParams } from 'expo-router';

import { QuizScreen } from '@/features/path/quiz-screen';

/** Unit quiz route (T17) — generated exercises over the unit's content. */
export default function QuizRoute() {
  const { packId } = useLocalSearchParams<{ packId: string }>();
  return <QuizScreen packId={packId} />;
}
