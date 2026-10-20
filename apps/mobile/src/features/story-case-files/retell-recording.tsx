import * as React from 'react';
import { View } from 'react-native';
import { track } from '@/services/analytics';
import { Text } from '@/components/ui/text';
import { useLabAudio } from '@/features/listening-lab/use-lab-audio';
import { KeepTakeButton, PracticeButton } from '@/features/practice-retelling/ui';
import type { PracticeContext } from '@/features/practice-retelling/model';
/** Shared native capture/focus/lifecycle. Only an explicit Keep promotes the cache take. */
export function RetellRecording({ context }: { context: PracticeContext }) {
  const audio = useLabAudio();
  React.useEffect(() => {
    if (audio.phase === 'recording' || audio.phase === 'playing')
      track('case_file_recording', {
        caseId: context.contextId,
        stage: context.stage,
        action: audio.phase === 'recording' ? 'started' : 'played',
      });
  }, [audio.phase, context.contextId, context.stage]);
  React.useEffect(() => {
    if (audio.take)
      track('case_file_recording', {
        caseId: context.contextId,
        stage: context.stage,
        action: 'finished',
        durationMs: audio.take.durationMs,
      });
  }, [audio.take, context.contextId, context.stage]);
  React.useEffect(() => {
    if (audio.error)
      track('case_file_recording', {
        caseId: context.contextId,
        stage: context.stage,
        action: 'unavailable',
      });
  }, [audio.error, context.contextId, context.stage]);
  const busy = audio.phase === 'loading' || audio.phase === 'processing';
  return (
    <View className="mt-5 gap-3">
      <Text variant="title">Say it aloud</Text>
      <Text variant="caption">
        Optional · up to 60 seconds. Use Keep recording to retain the original audio. Unkept takes
        are deleted when you leave; typed retellings are saved with your completed attempt.
      </Text>
      {audio.phase === 'recording' ? (
        <>
          <Text accessibilityLiveRegion="polite">Recording…</Text>
          <PracticeButton onPress={() => void audio.finishRecording()}>
            Stop recording
          </PracticeButton>
          <PracticeButton onPress={() => void audio.stop()}>Cancel recording</PracticeButton>
        </>
      ) : (
        <PracticeButton disabled={busy} onPress={() => void audio.startRecording()}>
          Record a take
        </PracticeButton>
      )}
      {audio.take && audio.phase !== 'recording' && (
        <>
          <PracticeButton disabled={busy} onPress={() => void audio.playTake()}>
            Play take
          </PracticeButton>
          <KeepTakeButton key={audio.take.path} take={audio.take} context={context} />
        </>
      )}
      {audio.phase === 'playing' && (
        <PracticeButton onPress={() => void audio.stop()}>Stop playback</PracticeButton>
      )}
      {audio.error && (
        <Text className="text-danger" accessibilityRole="alert">
          {audio.error}
        </Text>
      )}
    </View>
  );
}
