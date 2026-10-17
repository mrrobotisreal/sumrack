import { useLocalSearchParams } from 'expo-router';

import { LessonScreen } from '@/features/hotel/lesson/lesson-screen';

/** A hotel unit's lesson (T90): the paged cards, resume, the finale. */
export default function HotelLessonRoute() {
  const { packId, unitId } = useLocalSearchParams<{ packId: string; unitId: string }>();
  return <LessonScreen packId={packId} unitId={unitId} />;
}
