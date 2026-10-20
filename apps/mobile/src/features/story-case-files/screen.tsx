import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { StoryDetail } from '@/db/repositories/content';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';
import { CASE_FILES, findCaseFile } from './catalog';
import { useCaseFile } from './hooks';
import {
  caseAvailability,
  type CaseAttempt,
  type CaseDraft,
  type CaseFile,
  type CaseStage,
} from './model';
import { createCaseDraftStore, saveCaseAttempt } from './persistence';
import { RetellRecording } from './retell-recording';

function Action({
  children,
  onPress,
  disabled = false,
  primary = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-xl px-4 py-3 active:opacity-80 ${primary ? 'bg-accent' : 'border border-border bg-surface'} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={primary ? 'font-ui-bold text-white' : ''}>{children}</Text>
    </Pressable>
  );
}

const unavailableCopy = {
  missing: 'Download the A1 NoEnd House pack from Packs, then return here.',
  stale:
    'This companion needs A1 NoEnd House version 3 with its original sentence references. Update your app or use the matching pack before trying again.',
  unread:
    'Finish reading this part first. Its case file opens only after the reader records the part as finished.',
};

export function CaseFileScreen({ id }: { id: string }) {
  const file = findCaseFile(id);
  const query = useCaseFile(file);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const availability = query.data?.availability;
  React.useEffect(() => {
    if (file && availability && !query.isFetching)
      track(availability === 'ready' ? 'case_file_opened' : 'case_file_unavailable', {
        caseId: file.id,
        reason: availability,
      });
  }, [file, availability, query.isFetching]);
  if (!file)
    return (
      <View className="flex-1 gap-4 bg-bg p-5">
        <Text variant="title">Case file not found</Text>
        <Action onPress={() => router.replace('/case-files')}>Browse case files</Action>
      </View>
    );
  if (query.isPending || (!query.isFetchedAfterMount && !query.isError))
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator accessibilityLabel="Loading case file" />
      </View>
    );
  if (query.isError)
    return (
      <View className="flex-1 gap-4 bg-bg p-5">
        <Text>Could not load this case file. Your saved attempts are safe.</Text>
        <Action onPress={() => void query.refetch()}>Try again</Action>
      </View>
    );
  if (!query.data || availability !== 'ready' || !query.data.source)
    return (
      <View className="flex-1 gap-4 bg-bg p-5">
        <Text variant="heading">Case file unavailable</Text>
        <Text>
          {unavailableCopy[availability && availability !== 'ready' ? availability : 'missing']}
        </Text>
        <Action
          onPress={() =>
            availability === 'unread'
              ? router.push({
                  pathname: '/reader/[packId]/[storyId]',
                  params: { packId: file.packId, storyId: file.storyId, from: 'case-file' },
                })
              : router.push('/packs')
          }
        >
          {availability === 'unread' ? 'Continue reading' : 'Open Packs'}
        </Action>
        <Action onPress={() => void query.refetch()}>Check again</Action>
      </View>
    );
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-bg">
      {query.isFetching && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator accessibilityLabel="Checking the source pack" />
        </View>
      )}
      <ScrollView
        style={{ display: query.isFetching ? 'none' : 'flex' }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
      >
        <CaseWork
          key={file.id}
          file={file}
          source={query.data.source}
          attempts={query.data.attempts}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CaseWork({
  file,
  source,
  attempts,
}: {
  file: CaseFile;
  source: StoryDetail;
  attempts: CaseAttempt[];
}) {
  const router = useRouter();
  const client = useQueryClient();
  const { tokens } = useAppTheme();
  const [store] = React.useState(() => createCaseDraftStore(AsyncStorage, file));
  const [draft, setDraft] = React.useState<CaseDraft | null>(null);
  const [review, setReview] = React.useState<CaseAttempt | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [loadGeneration, setLoadGeneration] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedDraft, setSavedDraft] = React.useState(true);
  const [showHelp, setShowHelp] = React.useState(false);
  const busy = React.useRef(false);
  const serial = React.useRef(0);
  const attemptsRef = React.useRef(attempts);
  React.useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);
  React.useEffect(() => {
    let live = true;
    void store
      .read()
      .then((saved) => {
        if (!live) return;
        setLoadFailed(false);
        const existing = saved && attemptsRef.current.find((a) => a.id === saved.id);
        if (existing) setReview(existing);
        else setDraft(saved);
        setLoaded(true);
      })
      .catch(() => {
        if (live) {
          setLoadFailed(true);
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [store, loadGeneration]);

  const persist = React.useCallback(
    (next: CaseDraft) => {
      setDraft(next);
      setSavedDraft(false);
      const current = ++serial.current;
      void store
        .write(next)
        .then(() => {
          if (current === serial.current) setSavedDraft(true);
        })
        .catch(() => {
          setError(
            'Draft could not be saved on this device. Keep this screen open and try saving the completed attempt.',
          );
        });
    },
    [store],
  );
  const start = React.useCallback(
    (stage: CaseStage) => {
      setReview(null);
      setShowHelp(false);
      setError(null);
      persist({
        schemaVersion: 1,
        id: randomUUID(),
        caseId: file.id,
        revision: file.revision,
        stage,
        startedAt: Date.now(),
        answers: {},
        retelling: '',
        checklist: [],
        helped: false,
      });
      track('case_file_started', {
        caseId: file.id,
        stage,
        priorAttempts: attempts.filter((a) => a.stage === stage).length,
      });
    },
    [attempts, file, persist],
  );
  const help = () => {
    if (draft && !review) persist({ ...draft, helped: true });
    setShowHelp(true);
    track('case_file_help', { caseId: file.id, stage: draft?.stage ?? 'story' });
  };
  const openSource = (sid: string) => {
    const sentence = source.sentences.find((s) => s.id === sid);
    if (!sentence) return;
    if (draft && !review) help();
    router.push({
      pathname: '/reader/[packId]/[storyId]',
      params: {
        packId: file.packId,
        storyId: file.storyId,
        sentenceIdx: String(sentence.orderIdx),
        from: 'case-file',
      },
    });
  };
  const submit = async () => {
    if (!draft || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const [freshSource, progress] = await Promise.all([
        repos.content.getStoryDetail(file.packId, file.storyId),
        repos.reading.getProgress(file.packId, file.storyId),
      ]);
      if (caseAvailability(file, freshSource, progress) !== 'ready')
        throw new Error(
          'The source pack or reading status changed. Return to the case-file list and check the pack.',
        );
      const result = await saveCaseAttempt(repos.learningSessions, file, draft);
      setReview(result);
      setDraft(null);
      await store.clear();
      setSavedDraft(true);
      track('case_file_completed', {
        caseId: file.id,
        stage: result.stage,
        helped: result.helped,
        exposure: result.exposure,
        correctCount: result.correctCount,
        itemCount: result.itemCount,
        durationMs: result.endedAt - result.startedAt,
      });
      await client.invalidateQueries({ queryKey: ['case-files'] });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save the attempt. Try again; the same attempt will not be duplicated.',
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  if (!loaded) return <ActivityIndicator accessibilityLabel="Loading your draft" />;
  if (loadFailed)
    return (
      <View className="gap-4">
        <Text>Could not load your local draft. Retry before starting another attempt.</Text>
        <Action
          onPress={() => {
            setLoaded(false);
            setLoadGeneration((n) => n + 1);
          }}
        >
          Retry loading draft
        </Action>
      </View>
    );
  const current = review ?? draft;
  const activity = current?.stage === 'transfer' ? file.transfer : file;
  const canSave =
    !!draft &&
    draft.retelling.trim().length > 0 &&
    activity.questions.every((q) => draft.answers[q.id] !== undefined);

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text variant="caption">NoEnd House · A1 · optional practice</Text>
        <Text variant="heading">{file.title}</Text>
        <Text variant="muted">
          Understand what happened, distinguish a fact from a guess, then tell it in your own words.
        </Text>
      </View>
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {!current ? (
        <View className="gap-3">
          <Text>
            Five questions and a short retelling. Your typed answer is saved offline. This is
            authored practice and self-review, with no AI or pronunciation score.
          </Text>
          <Action primary onPress={() => start('story')}>
            Start the case file
          </Action>
          {attempts.some((a) => a.stage === 'story') && (
            <Action onPress={() => start('transfer')}>Try an everyday transfer</Action>
          )}
        </View>
      ) : (
        <>
          <View className="gap-2">
            <Text variant="title">
              {current.stage === 'transfer' ? activity.title : 'The story case'}
            </Text>
            <Text variant="caption">
              {review
                ? `${review.correctCount}/${review.itemCount} questions · ${review.exposure} exposure · ${review.helped ? 'with source help' : 'without source help'} · ${review.stage === 'transfer' ? 'everyday transfer' : 'story context'}`
                : `${draft?.helped ? 'Source help used' : 'No source help yet'} · ${savedDraft ? 'Draft saved on this device' : 'Saving draft…'}`}
            </Text>
            {!review && (
              <Text variant="caption">
                Drafts stay on this device. Save the completed attempt to include the typed
                retelling in your normal backup and sync.
              </Text>
            )}
          </View>
          {current.stage === 'transfer' && (
            <View className="gap-3">
              <Text variant="caption">Original everyday passage · read before answering</Text>
              {file.transfer.sentences.map((s) => (
                <Text key={s.id} variant="reading">
                  {s.ru}
                </Text>
              ))}
            </View>
          )}
          {!review && current.stage === 'story' && <Action onPress={help}>Show source help</Action>}
          {showHelp && !review && current.stage === 'story' && (
            <View className="gap-3">
              <Text variant="caption">Source help · this attempt is marked as helped</Text>
              {file.source.map((s) => (
                <View key={s.id} className="gap-1">
                  <Text variant="reading">{s.ru}</Text>
                  <Action onPress={() => openSource(s.id)}>Open this sentence in the reader</Action>
                </View>
              ))}
            </View>
          )}
          {activity.questions.map((q, index) => {
            const selected = current.answers[q.id];
            const result = review?.results.find((r) => r.questionId === q.id);
            return (
              <View key={q.id} className="gap-3 border-b border-border pb-6">
                <Text variant="caption">
                  Question {index + 1} of {activity.questions.length} · {q.kind}
                </Text>
                <Text variant="reading">{q.prompt}</Text>
                {q.options.map((o) => (
                  <Pressable
                    key={o.id}
                    accessibilityRole="radio"
                    accessibilityLabel={o.text}
                    accessibilityState={{
                      checked: selected === o.id,
                      disabled: !!review || saving,
                    }}
                    disabled={!!review || saving}
                    onPress={() =>
                      draft && persist({ ...draft, answers: { ...draft.answers, [q.id]: o.id } })
                    }
                    className={`min-h-12 rounded-xl border p-4 active:opacity-80 ${selected === o.id ? 'border-accent bg-accent/10' : 'border-border bg-surface'}`}
                  >
                    <Text>
                      {selected === o.id ? '● ' : '○ '}
                      {o.text}
                    </Text>
                  </Pressable>
                ))}
                {review && (
                  <View className="gap-3">
                    <Text className="font-ui-bold">
                      {result?.correct ? 'Supported answer' : 'Review this answer'}
                    </Text>
                    <Text>{q.explanation}</Text>
                    <Text variant="caption">
                      Accepted:{' '}
                      {q.options
                        .filter((o) => q.accepted.includes(o.id))
                        .map((o) => o.text)
                        .join(' / ')}
                    </Text>
                    {q.sourceIds.map((sid) => {
                      const sentence =
                        current.stage === 'story'
                          ? file.source.find((s) => s.id === sid)
                          : file.transfer.sentences.find((s) => s.id === sid);
                      return (
                        <View key={sid} className="gap-1">
                          <Text variant="reading">{sentence?.ru}</Text>
                          {current.stage === 'story' && (
                            <Action onPress={() => openSource(sid)}>
                              Read the supporting sentence
                            </Action>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
          <View className="gap-3">
            <Text variant="title">Your retelling</Text>
            <Text variant="reading">{activity.retellPrompt}</Text>
            {review ? (
              <Text variant="reading" selectable>
                {review.retelling}
              </Text>
            ) : (
              <TextInput
                multiline
                textAlignVertical="top"
                value={draft?.retelling ?? ''}
                onChangeText={(text) => draft && persist({ ...draft, retelling: text })}
                maxLength={12000}
                editable={!saving}
                accessibilityLabel="Your Russian retelling"
                placeholder="Напишите несколько предложений…"
                placeholderTextColor={tokens.textMuted}
                className="min-h-40 rounded-xl border border-border bg-surface p-4 font-reading text-lg leading-8 text-text"
              />
            )}
            <Text variant="title">Self-review</Text>
            <Text variant="caption">
              Check what your retelling includes. This checklist is your own reflection and is not
              scored.
            </Text>
            {activity.checklist.map((item, i) => (
              <Pressable
                key={item}
                accessibilityRole="checkbox"
                accessibilityLabel={item}
                accessibilityState={{
                  checked: current.checklist.includes(i),
                  disabled: !!review || saving,
                }}
                disabled={!!review || saving}
                onPress={() =>
                  draft &&
                  persist({
                    ...draft,
                    checklist: draft.checklist.includes(i)
                      ? draft.checklist.filter((n) => n !== i)
                      : [...draft.checklist, i],
                  })
                }
                className="min-h-12 flex-row items-center gap-3 rounded-xl bg-surface px-4 py-3"
              >
                <Text>{current.checklist.includes(i) ? '☑' : '☐'}</Text>
                <Text className="flex-1">{item}</Text>
              </Pressable>
            ))}
            {!review && <RetellRecording caseId={file.id} stage={current.stage} />}
          </View>
          {review ? (
            <View className="gap-3">
              <Text variant="caption">
                Saved {new Date(review.endedAt).toLocaleString()}. This attempt stays unchanged when
                you retry.
              </Text>
              <Action
                primary
                onPress={() => start(review.stage === 'story' ? 'transfer' : 'story')}
              >
                {review.stage === 'story' ? 'Try an everyday transfer' : 'Practice the story again'}
              </Action>
              <Action onPress={() => start(review.stage)}>
                Start a fresh attempt of this activity
              </Action>
            </View>
          ) : (
            <View className="gap-3">
              <Action primary disabled={!canSave || saving} onPress={() => void submit()}>
                {saving ? 'Saving attempt…' : 'Save attempt and review answers'}
              </Action>
              {!canSave && (
                <Text variant="caption">
                  Answer every question and add a typed retelling to save.
                </Text>
              )}
            </View>
          )}
        </>
      )}
      {attempts.length > 0 && (
        <View className="mt-3 gap-3 border-t border-border pt-5">
          <Text variant="title">Saved attempts</Text>
          {draft && (
            <Text variant="caption">
              Your current draft stays saved when you view an earlier attempt.
            </Text>
          )}
          {attempts.map((a) => (
            <Action
              key={a.id}
              onPress={() => {
                setReview(a);
                setShowHelp(false);
              }}
            >{`${a.stage === 'story' ? 'Story' : 'Transfer'} · ${a.correctCount}/${a.itemCount} · ${a.helped ? 'helped' : 'unaided'} · ${new Date(a.endedAt).toLocaleString()}`}</Action>
          ))}
          {review && draft && <Action onPress={() => setReview(null)}>Return to your draft</Action>}
        </View>
      )}
    </View>
  );
}

export function CaseFilesScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
    >
      <Text variant="heading">Story case files</Text>
      <Text variant="muted" className="mb-6 mt-2">
        Optional practice after each finished part. Read first, investigate, then retell.
      </Text>
      {CASE_FILES.map((file) => (
        <CaseListItem key={file.id} file={file} />
      ))}
    </ScrollView>
  );
}
function CaseListItem({ file }: { file: CaseFile }) {
  const query = useCaseFile(file);
  const router = useRouter();
  const available = query.data?.availability;
  return (
    <View className="gap-3 border-b border-border py-5">
      <Text variant="title">{file.title}</Text>
      <Text variant="muted">
        {query.isError
          ? 'Could not check this part.'
          : available === 'ready'
            ? 'Ready · comprehension, retelling and an everyday transfer'
            : available === 'unread'
              ? 'Finish this part in the reader to unlock.'
              : available === 'stale'
                ? 'Companion and installed pack versions do not match.'
                : query.isPending
                  ? 'Checking your library…'
                  : 'Download A1 NoEnd House to begin.'}
      </Text>
      <Action
        onPress={() => router.push({ pathname: '/case-files/[id]', params: { id: file.id } })}
      >
        {available === 'ready' ? 'Open case file' : 'View availability'}
      </Action>
    </View>
  );
}
