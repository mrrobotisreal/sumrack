import { useLocalSearchParams } from 'expo-router';

import { ReaderScreen } from '@/features/reader/reader-screen';

/** Full-screen story reader route (modal-free per UI_DESIGN §3). */
export default function ReaderRoute() {
  const { packId, storyId, from, sentenceIdx } = useLocalSearchParams<{
    packId: string;
    storyId: string;
    from?: string;
    /** T24 deep link (search/bookmarks): open scrolled to this orderIdx. */
    sentenceIdx?: string;
  }>();
  const parsedIdx = sentenceIdx != null ? Number.parseInt(sentenceIdx, 10) : Number.NaN;
  return (
    <ReaderScreen
      packId={packId}
      storyId={storyId}
      from={from}
      initialSentenceIdx={Number.isNaN(parsedIdx) ? undefined : parsedIdx}
    />
  );
}
