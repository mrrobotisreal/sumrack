import { useLocalSearchParams } from 'expo-router';

import { ReaderScreen } from '@/features/reader/reader-screen';

/** Full-screen story reader route (modal-free per UI_DESIGN §3). */
export default function ReaderRoute() {
  const { packId, storyId, from } = useLocalSearchParams<{
    packId: string;
    storyId: string;
    from?: string;
  }>();
  return <ReaderScreen packId={packId} storyId={storyId} from={from} />;
}
