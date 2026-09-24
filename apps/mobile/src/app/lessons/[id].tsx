import { useLocalSearchParams } from 'expo-router';

import { LessonScreen } from '@/features/word-forms/lesson-screen';

/** One saved grammar lesson (M16/T54, WORD_FORMS §7.3). */
export default function LessonRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LessonScreen id={id} />;
}
