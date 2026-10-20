import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';
import { useLabAudio } from '@/features/listening-lab/use-lab-audio';
import { bundlePracticeRecording } from '@/features/scenario/recordings/bundle-service';
import type { CaseAttempt } from '@/features/story-case-files/model';
import { practiceStore } from './runtime-store';
import {
  cancelRetellingFeedback,
  pumpRetellingFeedback,
  requestRetellingFeedback,
} from './feedback-service';
import {
  cleanDeletedPracticeFiles,
  confirmPracticeTranscript,
  deletePracticeTake,
  keepPracticeTake,
  practiceKey,
  practiceRecordingFile,
  refreshPractice,
  removePracticeLocal,
  restorePracticeTake,
  transcribePracticeTake,
} from './media-service';
import {
  feedbackStatus,
  keptMedia,
  mediaBundleState,
  type FeedbackRequest,
  type KeptMedia,
  type PracticeContext,
  type PracticeEvent,
} from './model';

export function PracticeButton({
  children,
  onPress,
  disabled = false,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-xl border border-border bg-surface px-4 py-3 active:opacity-80 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text>{children}</Text>
    </Pressable>
  );
}
export function usePracticeEvents() {
  const query = useQuery({
    queryKey: practiceKey,
    queryFn: async () => {
      await cleanDeletedPracticeFiles();
      return practiceStore.list();
    },
  });
  const { refetch } = query;
  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return query;
}
export function KeepTakeButton({
  take,
  context,
}: {
  take: { path: string; durationMs: number };
  context: PracticeContext;
}) {
  const [kept, setKept] = React.useState(false);
  const [captureContext] = React.useState(context);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mediaId] = React.useState(() => `practice-${randomUUID()}`);
  const lock = React.useRef(false);
  async function keep() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await keepPracticeTake(mediaId, take.path, take.durationMs, captureContext);
      setKept(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not keep this take. Try again before leaving.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View className="gap-2">
      <PracticeButton disabled={busy || kept} onPress={() => void keep()}>
        {kept ? 'Recording kept' : busy ? 'Keeping recording…' : 'Keep recording'}
      </PracticeButton>
      <Text variant="caption">
        Keep stores the original audio privately on this device. With Backup configured, an
        encrypted media bundle is uploaded separately. The 128 MiB limit never removes kept takes
        automatically.
      </Text>
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
    </View>
  );
}
export function PracticeMediaShelf({ context }: { context?: PracticeContext }) {
  const query = usePracticeEvents();
  const audio = useLabAudio();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const events = query.data ?? [];
  const takes = keptMedia(events).filter(
    (m) => !context || m.context.attemptId === context.attemptId,
  );
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await audio.stop();
      await work();
      refreshPractice();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'The recording action could not finish. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (query.isPending)
    return <ActivityIndicator accessibilityLabel="Loading retained recordings" />;
  if (query.isError)
    return (
      <View className="gap-2">
        <Text>Could not load your kept recordings.</Text>
        <PracticeButton onPress={() => void query.refetch()}>Retry recordings</PracticeButton>
      </View>
    );
  return (
    <View className="gap-4">
      <Text variant="title">Kept recordings</Text>
      {!takes.length && (
        <Text variant="muted">
          No kept takes for {context ? 'this attempt' : 'your practice'} yet. Use Keep recording
          after a take to retain it.
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {audio.error && <Text className="text-danger">{audio.error}</Text>}
      {audio.phase === 'playing' && (
        <PracticeButton onPress={() => void audio.stop()}>Stop recording playback</PracticeButton>
      )}
      {takes.map((take) => (
        <MediaCard
          key={take.mediaId}
          take={take}
          events={events}
          busy={busy}
          run={run}
          play={() =>
            void audio.play(
              {
                uri: practiceRecordingFile(take.mediaId).uri,
                startMs: 0,
                endMs: take.durationMs,
                stopAtFileEnd: true,
              },
              1,
            )
          }
        />
      ))}
    </View>
  );
}
function MediaCard({
  take,
  events,
  busy,
  run,
  play,
}: {
  take: KeptMedia;
  events: PracticeEvent[];
  busy: boolean;
  run(work: () => Promise<unknown>): Promise<void>;
  play(): void;
}) {
  const { tokens } = useAppTheme();
  const [correction, setCorrection] = React.useState<string | null>(null);
  const original = events
    .filter(
      (e) => e.kind === 'transcript' && e.mediaId === take.mediaId && e.source === 'asr-original',
    )
    .sort((a, b) => b.at - a.at)[0];
  const confirmed = events
    .filter(
      (e) => e.kind === 'transcript' && e.mediaId === take.mediaId && e.source === 'user-confirmed',
    )
    .sort((a, b) => b.at - a.at);
  const present = practiceRecordingFile(take.mediaId).exists;
  const bundle = mediaBundleState(events, take.mediaId);
  const deleteTake = () =>
    Alert.alert(
      'Delete kept recording?',
      'This removes the local audio and hides the take from current history. Previously uploaded encrypted backups keep their original snapshot. Your completed text and feedback stay unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete recording',
          style: 'destructive',
          onPress: () => void run(() => deletePracticeTake(take.mediaId)),
        },
      ],
    );
  return (
    <View className="gap-3 border-t border-border pt-4">
      <Text>
        {take.context.kind === 'case-file' ? 'Story' : 'Listening'} · {take.context.stage} ·{' '}
        {Math.ceil(take.durationMs / 1000)} sec · {new Date(take.at).toLocaleString()}
      </Text>
      <Text variant="caption">
        {take.context.helped ? 'Help used' : 'No marked help'} ·{' '}
        {take.context.repeated ? 'Repeated context' : 'First context'} ·{' '}
        {present ? 'Original audio on device' : 'Audio missing on this device'} ·{' '}
        {bundle === 'uploaded'
          ? 'Encrypted remote copy recorded'
          : bundle === 'failed'
            ? 'Backup upload failed'
            : 'Backup not yet confirmed'}
      </Text>
      {present ? (
        <>
          <PracticeButton disabled={busy} onPress={play}>
            Play kept recording
          </PracticeButton>
          <PracticeButton
            disabled={busy}
            onPress={() => void run(() => transcribePracticeTake(take.mediaId))}
          >
            Transcribe offline
          </PracticeButton>
          <PracticeButton
            disabled={busy}
            onPress={() => void run(() => bundlePracticeRecording(take.mediaId))}
          >
            Back up this recording
          </PracticeButton>
          {bundle === 'uploaded' && (
            <PracticeButton
              disabled={busy}
              onPress={() => void run(() => removePracticeLocal(take.mediaId))}
            >
              Remove local copy · keep restore option
            </PracticeButton>
          )}
        </>
      ) : (
        <PracticeButton
          disabled={busy}
          onPress={() => void run(() => restorePracticeTake(take.mediaId))}
        >
          Restore recording from Backup
        </PracticeButton>
      )}
      {original?.kind === 'transcript' && (
        <View className="gap-3">
          <Text variant="title">Original recognition · unconfirmed</Text>
          <Text variant="reading" selectable>
            {original.text || '(No words recognized)'}
          </Text>
          <Text variant="caption">
            {original.model} · {new Date(original.at).toLocaleString()}. Recognition may be wrong.
            Correct or confirm it before requesting grammar feedback; this is not evidence of a
            spoken mistake.
          </Text>
          <TextInput
            accessibilityLabel="Correct the recognition transcript"
            value={correction ?? original.text}
            onChangeText={setCorrection}
            multiline
            maxLength={12000}
            placeholderTextColor={tokens.textMuted}
            placeholder="What you intended to say…"
            className="min-h-28 rounded-xl border border-border bg-surface p-3 font-reading text-base text-text"
          />
          <PracticeButton
            disabled={busy || !(correction ?? original.text).trim()}
            onPress={() =>
              void run(async () => {
                await confirmPracticeTranscript(original.id, correction ?? original.text);
                setCorrection(null);
              })
            }
          >
            Save a confirmed transcript version
          </PracticeButton>
          {confirmed.map(
            (c) =>
              c.kind === 'transcript' && (
                <View key={c.id} className="gap-1">
                  <Text variant="caption">
                    Confirmed version · {new Date(c.at).toLocaleString()}
                  </Text>
                  <Text variant="reading" selectable>
                    {c.text}
                  </Text>
                </View>
              ),
          )}
        </View>
      )}
      <PracticeButton disabled={busy} onPress={deleteTake}>
        Delete kept recording
      </PracticeButton>
    </View>
  );
}
export function RetellingFeedbackPanel({ attempt }: { attempt: CaseAttempt }) {
  const query = usePracticeEvents();
  const [transcriptId, setTranscriptId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const events = query.data ?? [];
  const takeIds = new Set(
    keptMedia(events)
      .filter((m) => m.context.attemptId === attempt.id)
      .map((m) => m.mediaId),
  );
  const transcripts = events.filter(
    (e) => e.kind === 'transcript' && e.source === 'user-confirmed' && takeIds.has(e.mediaId),
  );
  const requests = events
    .filter(
      (e): e is FeedbackRequest =>
        e.kind === 'feedback-request' && e.context.attemptId === attempt.id,
    )
    .sort((a, b) => b.at - a.at);
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      refreshPractice();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update feedback. Try again.');
    } finally {
      setBusy(false);
    }
  }
  if (query.isError)
    return (
      <View className="gap-2">
        <Text>Could not load feedback history.</Text>
        <PracticeButton onPress={() => void query.refetch()}>Retry feedback history</PracticeButton>
      </View>
    );
  return (
    <View className="gap-3 border-t border-border pt-5">
      <Text variant="title">Optional retelling feedback</Text>
      <Text variant="muted">
        Online text coaching on supported facts, links between events and your phrasing. Your
        original answer stays unchanged. Offline self-review remains available above. No
        pronunciation or official exam score.
      </Text>
      <Text variant="caption">
        Source: {transcriptId ? 'your confirmed transcript' : 'saved typed retelling'}
      </Text>
      <PracticeButton disabled={busy} onPress={() => setTranscriptId(null)}>
        Use saved typed retelling
      </PracticeButton>
      {transcripts.map((t) => (
        <PracticeButton
          key={t.id}
          disabled={busy}
          onPress={() => setTranscriptId(t.id)}
        >{`Use confirmed transcript · ${new Date(t.at).toLocaleString()}`}</PracticeButton>
      ))}
      <PracticeButton
        disabled={busy || query.isPending}
        onPress={() =>
          void run(() =>
            requestRetellingFeedback(attempt, { transcriptId: transcriptId ?? undefined }),
          )
        }
      >
        Request optional feedback
      </PracticeButton>
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {requests.map((request) => {
        const status = feedbackStatus(events, request.requestId);
        const failure = events.find(
          (e) => e.kind === 'feedback-error' && e.requestId === request.requestId,
        );
        const result = events.find(
          (e) => e.kind === 'feedback-result' && e.requestId === request.requestId,
        );
        return (
          <View key={request.id} className="gap-3 border-t border-border pt-4">
            <Text variant="title">
              {status === 'done'
                ? 'Feedback saved'
                : status === 'queued'
                  ? 'Queued · waits for this device to be online'
                  : status === 'sending-or-interrupted'
                    ? 'Sent · awaiting result or interrupted'
                    : status === 'cancelled'
                      ? 'Request cancelled'
                      : 'Request failed'}
            </Text>
            <Text variant="caption">
              {request.model} · {request.rubric} · {request.inputKind} ·{' '}
              {request.context.helped ? 'help used' : 'no marked help'} ·{' '}
              {request.context.repeated ? 'repeated' : 'first'} context
              {request.supersedes ? ' · new review of earlier work' : ''}
            </Text>
            {(status === 'queued' || status === 'sending-or-interrupted') && (
              <>
                <Text variant="caption">
                  Requests run only on the device that created them. If a request stays queued while
                  online, configure the AI key in Settings. Sent requests are never resent
                  automatically; an interrupted or cancelled send may already have been charged.
                </Text>
                <PracticeButton
                  disabled={busy}
                  onPress={() => void run(() => cancelRetellingFeedback(request.requestId))}
                >
                  Cancel request
                </PracticeButton>
                {(status === 'queued' || status === 'sending-or-interrupted') && (
                  <PracticeButton
                    disabled={busy}
                    onPress={() => {
                      void pumpRetellingFeedback().catch(() =>
                        setError('Could not resume the queue. Your request is kept.'),
                      );
                    }}
                  >
                    {status === 'queued' ? 'Retry queue when online' : 'Check for a saved result'}
                  </PracticeButton>
                )}
              </>
            )}
            {failure?.kind === 'feedback-error' && status === 'failed' && (
              <Text variant="caption">
                {failure.code === 'http-auth' || failure.code === 'no-key'
                  ? 'Check your AI key in Settings.'
                  : failure.code === 'invalid-response'
                    ? 'The response did not meet the source and text-only checks.'
                    : 'The request could not finish.'}{' '}
                {failure.deliveryUnknown
                  ? 'A send may already have been charged; it will not be repeated automatically.'
                  : 'No request was sent.'}
              </Text>
            )}
            {status === 'done' && result?.kind === 'feedback-result' && (
              <>
                <Text variant="caption">Reviewed input (preserved)</Text>
                <Text variant="reading" selectable>
                  {request.input}
                </Text>
                {[...result.feedback.facts, ...result.feedback.links].map((o, i) => (
                  <View key={i} className="gap-1">
                    <Text>{o.comment}</Text>
                    <Text variant="caption">Source: {o.evidenceIds.join(', ')}</Text>
                  </View>
                ))}
                <Text>{result.feedback.ownWords}</Text>
                {result.feedback.grammar.map((g, i) => (
                  <View key={i} className="gap-1">
                    <Text variant="reading">
                      {g.original} → {g.suggestion}
                    </Text>
                    <Text>{g.explanation}</Text>
                  </View>
                ))}
                <Text>{result.feedback.nextStep}</Text>
              </>
            )}
            {['done', 'failed', 'cancelled'].includes(status) && (
              <>
                <Text variant="caption">
                  A new review is a new online request and may incur another charge. Previous
                  records remain in history.
                </Text>
                <PracticeButton
                  disabled={busy}
                  onPress={() =>
                    void run(() =>
                      requestRetellingFeedback(attempt, {
                        transcriptId: request.transcriptId ?? undefined,
                        regrade: true,
                      }),
                    )
                  }
                >
                  Request a new review
                </PracticeButton>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}
export function RetellingNotebookSection() {
  const query = usePracticeEvents();
  const router = useRouter();
  const events = query.data ?? [];
  const requests = events.filter(
    (e): e is FeedbackRequest =>
      e.kind === 'feedback-request' && feedbackStatus(events, e.requestId) === 'done',
  );
  return (
    <View className="gap-3">
      <Text variant="title">Retelling reflections</Text>
      <Text variant="muted">
        AI suggestions and confirmed transcripts are kept separately from established mistakes.
        Regrades and repeated/helped work never count as fresh unaided success.
      </Text>
      <PracticeButton onPress={() => router.push('/practice-recordings')}>
        Open kept practice recordings
      </PracticeButton>
      {requests.slice(0, 20).map((r) => (
        <PracticeButton
          key={r.id}
          onPress={() =>
            router.push({ pathname: '/case-files/[id]', params: { id: r.context.contextId } })
          }
        >{`${r.context.stage === 'transfer' ? 'Everyday transfer' : 'Story retelling'} · ${r.context.helped ? 'helped' : 'unaided'} · ${r.context.repeated ? 'repeated' : 'first'} · ${new Date(r.at).toLocaleDateString()}`}</PracticeButton>
      ))}
    </View>
  );
}
export function PracticeRecordingsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
    >
      <Stack.Screen options={{ title: 'Kept recordings' }} />
      <PracticeMediaShelf />
    </ScrollView>
  );
}
