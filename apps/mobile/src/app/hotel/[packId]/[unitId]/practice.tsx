import { useLocalSearchParams } from 'expo-router';

import { RunnerScreen } from '@/features/hotel/runner/runner-screen';

/** A unit's scored exercises (T90 unit mode): feedback after every answer. */
export default function HotelPracticeRoute() {
  const { packId, unitId } = useLocalSearchParams<{ packId: string; unitId: string }>();
  return <RunnerScreen packId={packId} unitId={unitId} mode="unit" />;
}
