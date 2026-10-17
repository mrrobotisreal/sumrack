import { useLocalSearchParams } from 'expo-router';

import { RunnerScreen } from '@/features/hotel/runner/runner-screen';

/**
 * A floor exam (`mode=floor`) or экстерн (`mode=extern`) under exam conditions
 * (T90 decision 5). Anything else falls back to the floor exam.
 */
export default function HotelExamRoute() {
  const { packId, mode } = useLocalSearchParams<{ packId: string; mode?: string }>();
  return <RunnerScreen packId={packId} mode={mode === 'extern' ? 'extern' : 'floor'} />;
}
