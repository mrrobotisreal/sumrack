import { useLocalSearchParams } from 'expo-router';

import { LessonScreen } from '@/features/path/lesson-screen';

/** Grammar mini-lesson of a course unit (T17). */
export default function LessonRoute() {
  const { packId } = useLocalSearchParams<{ packId: string }>();
  return <LessonScreen packId={packId} />;
}
