import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { assessDictation, assessMeaning, type Stage } from './attempt';
import { catalog, type ListeningSegment } from './catalog';
import { compareDictation } from './compare';
import { completeDraft, type LabDraft } from './draft';
import { draftStore, historyKey, useLabSession } from './lab-hooks';
import { LabButton, LabHeader } from './lab-ui';
import type { LoadedSegment } from './source';
import { useLabAudio } from './use-lab-audio';
import { KeepTakeButton, PracticeMediaShelf } from '@/features/practice-retelling/ui';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'listen', label: 'Listen' },
  { id: 'meaning', label: 'Meaning' },
  { id: 'dictation', label: 'Dictate' },
  { id: 'reveal', label: 'Compare' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'retell', label: 'Retell' },
];

export function ListeningLabSessionScreen() {
  const { segmentId } = useLocalSearchParams<{ segmentId: string }>();
  const segment = catalog.segments.find((s) => s.id === segmentId);
  if (!segment)
    return (
      <View className="flex-1 bg-bg">
        <LabHeader title="Listening lab" />
        <Text className="p-5">
          This segment is not in the current catalog. Go back and select a clip.
        </Text>
      </View>
    );
  return <LoadSession key={segment.id} segment={segment} />;
}
function LoadSession({ segment }: { segment: ListeningSegment }) {
  const query = useLabSession(segment),
    { tokens } = useAppTheme();
  if (query.isPending)
    return (
      <View className="flex-1 bg-bg">
        <LabHeader title="Listening lab" />
        <ActivityIndicator
          className="mt-8"
          color={tokens.accent}
          accessibilityLabel="Loading clip and saved draft"
        />
      </View>
    );
  if (query.isError)
    return (
      <View className="flex-1 bg-bg">
        <LabHeader title="Listening lab" />
        <View className="gap-4 p-5">
          <Text>Could not load this clip or its saved draft. Existing work is kept.</Text>
          <LabButton onPress={() => void query.refetch()}>Retry</LabButton>
        </View>
      </View>
    );
  return (
    <LabSession
      key={query.data.draft.id}
      segment={segment}
      initial={query.data.draft}
      loaded={query.data.loaded}
      retry={() => void query.refetch()}
    />
  );
}
function LabSession({
  segment,
  initial,
  loaded,
  retry,
}: {
  segment: ListeningSegment;
  initial: LabDraft;
  loaded: LoadedSegment;
  retry: () => void;
}) {
  const router = useRouter(),
    queryClient = useQueryClient(),
    insets = useSafeAreaInsets(),
    { tokens } = useAppTheme();
  const [draft, setDraft] = React.useState(initial);
  const draftRef = React.useRef(draft);
  const [draftError, setDraftError] = React.useState(false);
  const [helpShown, setHelpShown] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [finalPending, setFinalPending] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const committed = React.useRef(false);
  const finalRef = React.useRef<
    Parameters<typeof repos.learningSessions.recordCompleted>[0] | null
  >(null);
  const audio = useLabAudio();
  const startedTracked = React.useRef(false);
  const patch = (fn: (current: LabDraft) => LabDraft) => {
    if (saving || finalRef.current || committed.current) return;
    const next = fn(draftRef.current);
    draftRef.current = next;
    setDraft(next);
  };
  React.useEffect(() => {
    if (!committed.current)
      void draftStore
        .write(draft)
        .then(() => setDraftError(false))
        .catch(() => setDraftError(true));
  }, [draft]);
  React.useEffect(() => {
    if (!startedTracked.current) {
      track('listening_lab_started', {
        segment_id: segment.id,
        exposure: initial.attempt.priorExposures > 0 ? 'repeat' : 'first',
      });
      if (!loaded.available) track('listening_lab_unavailable', { segment_id: segment.id });
      startedTracked.current = true;
    }
  }, [segment.id, initial.attempt.priorExposures, loaded.available]);

  const changeStage = (stage: Stage) => {
    void audio.stop();
    setHelpShown(false);
    patch((d) => {
      const revealing =
        (stage === 'reveal' || stage === 'shadow') && !d.attempt.assistance.transcriptSeen;
      const dictation =
        stage === 'reveal' && !d.attempt.dictation && d.dictationText.trim()
          ? assessDictation(
              segment,
              d.dictationText,
              d.attempt.assistance,
              d.attempt.priorExposures,
              d.attempt.exposureKnown,
            )
          : d.attempt.dictation;
      if (revealing)
        track('listening_lab_help', {
          segment_id: segment.id,
          stage,
          count: d.attempt.assistance.help + 1,
        });
      return {
        ...d,
        stage,
        attempt: {
          ...d.attempt,
          dictation,
          visited: [...new Set([...d.attempt.visited, stage])],
          assistance: revealing
            ? { ...d.attempt.assistance, transcriptSeen: true, help: d.attempt.assistance.help + 1 }
            : d.attempt.assistance,
        },
      };
    });
  };
  const play = (slow: boolean) => {
    if (!loaded.available) return;
    void audio.play(loaded.audio, slow ? 0.75 : 1, () => {
      patch((d) => {
        const assistance = {
          ...d.attempt.assistance,
          plays: d.attempt.assistance.plays + 1,
          slowPlays: d.attempt.assistance.slowPlays + Number(slow),
        };
        track('listening_lab_replayed', {
          segment_id: segment.id,
          stage: d.stage,
          slow,
          count: assistance.plays,
        });
        return { ...d, attempt: { ...d.attempt, assistance } };
      });
    });
  };
  const help = () => {
    if (helpShown) return;
    setHelpShown(true);
    patch((d) => {
      const assistance = { ...d.attempt.assistance, help: d.attempt.assistance.help + 1 };
      track('listening_lab_help', {
        segment_id: segment.id,
        stage: d.stage,
        count: assistance.help,
      });
      return { ...d, attempt: { ...d.attempt, assistance } };
    });
  };
  const finishRecording = async () => {
    await audio.finishRecording();
  };
  React.useEffect(() => {
    if (!audio.take) return;
    const next = {
      ...draftRef.current,
      attempt: {
        ...draftRef.current.attempt,
        recording: { durationMs: audio.take.durationMs, retention: 'temporary-cache' as const },
      },
    };
    draftRef.current = next;
    setDraft(next);
  }, [audio.take]);
  const save = async () => {
    if (saving || committed.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      await audio.stop();
      if (!finalRef.current) {
        finalRef.current = completeDraft(draftRef.current, segment, Date.now());
        setFinalPending(true);
      }
      await repos.learningSessions.recordCompleted(finalRef.current);
      committed.current = true;
      // Successful durable save wins even if cache cleanup fails; reopening detects the final id.
      await draftStore.remove(segment.id).catch(() => {});
      track('listening_lab_completed', {
        segment_id: segment.id,
        duration_ms: finalRef.current.endedAt - initial.startedAt,
        count: finalRef.current.itemCount,
      });
      await queryClient.invalidateQueries({ queryKey: historyKey });
      router.back();
    } catch {
      setSaveError('Could not save this attempt. Your draft is kept; retry saves the same result.');
      setSaving(false);
    }
  };
  const attempt = draft.attempt,
    stage = draft.stage;
  const differences = attempt.dictation
    ? compareDictation(
        segment.transcript,
        attempt.dictation.response,
        segment.yoPolicy,
        segment.endingPairs,
      )
    : [];
  const busy = audio.phase === 'loading' || audio.phase === 'processing' || saving;
  const frozen = saving || finalPending;
  const canSave =
    attempt.assistance.plays > 0 ||
    !!attempt.meaning ||
    !!draft.dictationText.trim() ||
    !!draft.retellingText.trim() ||
    !!attempt.recording ||
    attempt.assistance.transcriptSeen;
  const recordingControls = (
    <View className="gap-3">
      <Text variant="muted">
        Record up to 60 seconds, then compare your voice with the model. This is self-review; no
        pronunciation score is calculated.
      </Text>
      {audio.phase === 'recording' ? (
        <>
          <Text accessibilityLiveRegion="polite" className="text-danger">
            Recording…
          </Text>
          <LabButton primary onPress={() => void finishRecording()}>
            Stop recording
          </LabButton>
          <LabButton onPress={() => void audio.stop()}>Cancel recording</LabButton>
        </>
      ) : (
        <LabButton primary disabled={busy || frozen} onPress={() => void audio.startRecording()}>
          Record a take
        </LabButton>
      )}
      {audio.take ? (
        <LabButton
          disabled={busy || audio.phase === 'recording'}
          onPress={() => void audio.playTake()}
        >{`Play my take · ${Math.ceil(audio.take.durationMs / 1000)} sec`}</LabButton>
      ) : null}
      {audio.take && audio.phase !== 'recording' && (
        <KeepTakeButton
          key={audio.take.path}
          take={audio.take}
          context={{
            kind: 'listening-lab',
            contextId: segment.id,
            attemptId: draft.id,
            stage,
            helped: attempt.assistance.help > 0 || attempt.assistance.transcriptSeen,
            repeated: attempt.priorExposures > 0,
          }}
        />
      )}
      <Text variant="caption">
        Unkept takes are temporary and deleted when you leave. Keep stores the original audio; typed
        words remain part of your completed attempt.
      </Text>
      <PracticeMediaShelf
        context={{
          kind: 'listening-lab',
          contextId: segment.id,
          attemptId: draft.id,
          stage,
          helped: attempt.assistance.help > 0 || attempt.assistance.transcriptSeen,
          repeated: attempt.priorExposures > 0,
        }}
      />
    </View>
  );
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LabHeader
        title={`${segment.level} · Listening clip ${Number(segment.id.slice(4)) > 10 ? Number(segment.id.slice(4)) - 10 : Number(segment.id.slice(4))}`}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
      >
        <View className="gap-4">
          <Text variant="caption">
            {attempt.priorExposures
              ? `Repeat practice · ${attempt.priorExposures} saved attempt(s)`
              : 'First saved lab attempt'}{' '}
            · {attempt.assistance.plays} plays · {attempt.assistance.slowPlays} slow ·{' '}
            {attempt.assistance.help} help
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {STAGES.map((s) => (
              <LabButton
                key={s.id}
                selected={s.id === stage}
                disabled={frozen}
                onPress={() => changeStage(s.id)}
              >
                {s.label}
              </LabButton>
            ))}
          </View>
          <Text variant="caption">
            {segment.yoPolicy === 'strict'
              ? 'This clip tests ё: type ё where you hear it.'
              : 'This clip accepts е and ё as equivalent.'}{' '}
            Capitalization, punctuation and stress marks are ignored.
          </Text>
          {loaded.available ? (
            <View className="gap-2">
              <View className="flex-row flex-wrap gap-2">
                <LabButton
                  disabled={busy || frozen || audio.phase === 'recording'}
                  primary={stage === 'listen'}
                  onPress={() => play(false)}
                >
                  {attempt.assistance.plays ? 'Replay model' : 'Play model'}
                </LabButton>
                <LabButton
                  disabled={busy || frozen || audio.phase === 'recording'}
                  onPress={() => play(true)}
                >
                  Play slowly · 0.75×
                </LabButton>
              </View>
              {audio.phase === 'playing' || audio.phase === 'loading' ? (
                <LabButton onPress={() => void audio.stop()}>Stop audio</LabButton>
              ) : null}
            </View>
          ) : (
            <View className="gap-3">
              <Text accessibilityLiveRegion="polite">{loaded.reason}</Text>
              <LabButton onPress={retry}>Retry audio availability</LabButton>
            </View>
          )}
          {audio.error ? (
            <Text className="text-danger" accessibilityRole="alert">
              {audio.error}
            </Text>
          ) : null}
          {stage === 'listen' ? (
            <View className="gap-4 py-4">
              <Text variant="reading">Listen for the whole thought.</Text>
              <Text variant="muted">
                The transcript stays hidden here. Listen once, then try the meaning question, or
                choose any stage above.
              </Text>
              <LabButton primary onPress={() => changeStage('meaning')}>
                Try the meaning
              </LabButton>
            </View>
          ) : null}
          {stage === 'meaning' ? (
            <View className="gap-3 py-3">
              <Text variant="title">{segment.meaning.question}</Text>
              {segment.meaning.options.map((option, i) => (
                <LabButton
                  key={option}
                  selected={attempt.meaning?.response === i}
                  disabled={!!attempt.meaning || frozen}
                  onPress={() =>
                    patch((d) => ({
                      ...d,
                      attempt: {
                        ...d.attempt,
                        meaning: assessMeaning(
                          segment,
                          i,
                          d.attempt.assistance,
                          d.attempt.priorExposures,
                          d.attempt.exposureKnown,
                        ),
                        assistance: {
                          ...d.attempt.assistance,
                          help: d.attempt.assistance.help + 1,
                        },
                      },
                    }))
                  }
                >
                  {option}
                </LabButton>
              ))}
              {attempt.meaning ? (
                <>
                  <Text accessibilityLiveRegion="polite">
                    {attempt.meaning.correct
                      ? 'Correct.'
                      : `Answer: ${segment.meaning.options[segment.meaning.correctIndex]}.`}{' '}
                    {attempt.meaning.firstLabListen
                      ? 'First lab listen; earlier exposure unknown.'
                      : 'Supported or repeated practice.'}
                  </Text>
                  <Text variant="caption">Answer feedback counts as help for later stages.</Text>
                  <LabButton primary onPress={() => changeStage('dictation')}>
                    Try dictation
                  </LabButton>
                </>
              ) : null}
            </View>
          ) : null}
          {stage === 'dictation' ? (
            <View className="gap-3 py-3">
              <Text variant="title">Write what you hear</Text>
              <TextInput
                accessibilityLabel="Russian dictation"
                multiline
                autoCorrect={false}
                editable={!attempt.dictation && !frozen}
                maxLength={4000}
                value={draft.dictationText}
                onChangeText={(dictationText) => patch((d) => ({ ...d, dictationText }))}
                placeholder="Type in Russian…"
                placeholderTextColor={tokens.textMuted}
                textAlignVertical="top"
                className="min-h-32 rounded-xl border border-border bg-surface p-4 font-reading text-base text-text"
              />
              <Text variant="caption">
                Your first submitted dictation is kept. Compare mode shows word-level differences.
              </Text>
              <LabButton
                primary
                disabled={(!draft.dictationText.trim() && !attempt.dictation) || frozen}
                onPress={() => changeStage('reveal')}
              >
                Check and reveal
              </LabButton>
            </View>
          ) : null}
          {stage === 'reveal' || stage === 'shadow' ? (
            <View className="gap-3 py-3">
              <Text variant="caption">Model transcript</Text>
              <Text variant="reading" selectable>
                {segment.transcript}
              </Text>
              <Text variant="muted">{segment.translation}</Text>
              {stage === 'reveal' ? (
                <>
                  {attempt.dictation ? (
                    <>
                      <Text variant="caption">Your first dictation</Text>
                      <Text variant="reading" selectable>
                        {attempt.dictation.response}
                      </Text>
                      <Text>
                        {attempt.dictation.correct
                          ? 'All words match.'
                          : 'Compare each difference below.'}
                      </Text>
                      {differences
                        .filter((d) => d.kind !== 'correct')
                        .map((d, i) => (
                          <View key={i} className="border-b border-border py-3">
                            <Text>
                              {d.kind === 'missing'
                                ? `Missing: ${d.expected}`
                                : d.kind === 'extra'
                                  ? `Extra: ${d.actual}`
                                  : `${d.actual} → ${d.expected}`}
                            </Text>
                            <Text variant="caption">
                              {d.note ??
                                (d.kind === 'spelling'
                                  ? 'Possible spelling error (one letter).'
                                  : d.kind === 'wrong'
                                    ? 'Different word.'
                                    : d.kind === 'missing'
                                      ? 'This word was not in your answer.'
                                      : 'This word is not in the model.')}
                            </Text>
                          </View>
                        ))}
                    </>
                  ) : (
                    <Text variant="caption">
                      No dictation submitted. You can still study the model.
                    </Text>
                  )}
                  <LabButton primary onPress={() => changeStage('shadow')}>
                    Shadow the model
                  </LabButton>
                </>
              ) : null}
              <Text variant="caption">
                Source: {segment.source.packId} v{segment.source.packVersion} ·{' '}
                {segment.source.storyId}/{segment.source.sentenceId} · {segment.source.trackId}.
                Sentence timing checked; ear check pending.
              </Text>
            </View>
          ) : null}
          {stage === 'shadow' ? (
            <View className="gap-4">
              <Text variant="title">Listen, echo, compare</Text>
              {recordingControls}
              <LabButton onPress={() => changeStage('retell')}>Try a short retelling</LabButton>
            </View>
          ) : null}
          {stage === 'retell' ? (
            <View className="gap-4 py-3">
              <Text variant="title">Retell it in your own words</Text>
              <Text variant="muted">
                Say who is speaking and what they need or describe. One or two Russian sentences is
                enough.
              </Text>
              {recordingControls}
              <TextInput
                accessibilityLabel="Russian retelling saved as text"
                multiline
                editable={!frozen}
                autoCorrect={false}
                maxLength={4000}
                value={draft.retellingText}
                onChangeText={(retellingText) => patch((d) => ({ ...d, retellingText }))}
                placeholder="Keep your retelling in Russian…"
                placeholderTextColor={tokens.textMuted}
                textAlignVertical="top"
                className="min-h-32 rounded-xl border border-border bg-surface p-4 font-reading text-base text-text"
              />
              <Text variant="caption">Your self-review</Text>
              <View className="gap-2">
                {(['needs-practice', 'comfortable'] as const).map((selfReview) => (
                  <LabButton
                    key={selfReview}
                    selected={attempt.selfReview === selfReview}
                    disabled={frozen}
                    onPress={() => patch((d) => ({ ...d, attempt: { ...d.attempt, selfReview } }))}
                  >
                    {selfReview === 'comfortable'
                      ? 'I could express the main idea'
                      : 'I want another try'}
                  </LabButton>
                ))}
              </View>
            </View>
          ) : null}
          {stage !== 'reveal' && stage !== 'shadow' ? (
            <>
              <LabButton disabled={frozen || helpShown} onPress={help}>
                Show English meaning (help)
              </LabButton>
              {helpShown ? <Text variant="muted">{segment.translation}</Text> : null}
            </>
          ) : null}
          <View className="mt-3 gap-3 border-t border-border pt-5">
            {draftError ? (
              <Text accessibilityRole="alert" className="text-danger">
                Could not update the local draft. Keep this screen open and retry saving before
                leaving.
              </Text>
            ) : (
              <Text variant="caption">
                Unfinished text stays on this device. Save the attempt to include it in your backup
                and sync.
              </Text>
            )}
            {saveError ? (
              <Text accessibilityRole="alert" className="text-danger">
                {saveError}
              </Text>
            ) : null}
            <LabButton
              primary={stage === 'retell'}
              disabled={
                saving || audio.phase === 'recording' || audio.phase === 'processing' || !canSave
              }
              onPress={() => void save()}
            >
              {saving ? 'Saving…' : saveError ? 'Retry saving attempt' : 'Save attempt and finish'}
            </LabButton>
            <Text variant="caption">
              A first lab listen means one normal play in your first saved lab attempt, without
              help. Earlier exposure in other lessons is unknown. Replays and repeated practice stay
              separate; this lab does not change review cards.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
