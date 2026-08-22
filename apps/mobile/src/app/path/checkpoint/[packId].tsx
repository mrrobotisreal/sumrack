import { useLocalSearchParams } from 'expo-router';

import { CheckpointScreen } from '@/features/path/checkpoint-screen';

/** Checkpoint runner route (T17) — authored level-transition test. */
export default function CheckpointRoute() {
  const { packId } = useLocalSearchParams<{ packId: string }>();
  return <CheckpointScreen packId={packId} />;
}
