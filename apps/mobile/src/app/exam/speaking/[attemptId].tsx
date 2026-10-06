import { useLocalSearchParams } from 'expo-router';

import { SpeakingDebriefScreen } from '@/features/torfl/speaking/speaking-debrief-screen';

/** Speaking debrief route (T73): `/exam/speaking/<attemptId>` — recordings, transcripts, criteria, model answers. */
export default function ExamSpeakingDebriefRoute() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  return <SpeakingDebriefScreen attemptId={attemptId} />;
}
