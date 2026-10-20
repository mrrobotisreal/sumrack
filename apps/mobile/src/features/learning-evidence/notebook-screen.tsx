import { useQueryClient } from '@tanstack/react-query';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
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
import { RetellingNotebookSection } from '@/features/practice-retelling/ui';
import { QueryError } from '@/components/query-error';
import { repos } from '@/db';
import { newId } from '@/db/ids';
import type { CompletedLearningSession } from '@/db/repositories/learning-sessions';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';
import { SKILLS, type PilotSkill, type PracticePrompt } from './catalog';
import { evidenceKey, useLearningEvidence } from './hooks';
import {
  gradePractice,
  localDay,
  nextPractice,
  EXPOSURE_MODE,
  PRACTICE_MODE,
  PracticeDetailSchema,
  summarizeEvidence,
  type LearningEvidence,
} from './model';

export function NotebookScreen({ skill }: { skill?: PilotSkill }) {
  const query = useLearningEvidence();
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [explanation, setExplanation] = React.useState(false);
  const [example, setExample] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [practice, setPractice] = React.useState<{
    prompt: PracticePrompt;
    repeat: boolean;
    assisted: boolean;
  } | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      track('learning_evidence_opened', { skill: skill ?? 'all' });
      void qc.invalidateQueries({ queryKey: evidenceKey });
    }, [qc, skill]),
  );
  const rows = query.data?.events ?? [];
  const summaries = summarizeEvidence(rows);
  const summary = summaries.find((s) => s.skill === skill);
  async function exposeHelp(action: () => void) {
    if (!skill || starting) return;
    setStarting(true);
    setActionError(null);
    const at = Date.now();
    try {
      await repos.learningSessions.recordCompleted({
        id: newId(),
        mode: EXPOSURE_MODE,
        startedAt: at,
        endedAt: at,
        itemCount: 0,
        correctCount: 0,
        detail: { v: 1, skill, kind: 'help' },
      });
      await qc.invalidateQueries({ queryKey: evidenceKey });
      track('learning_evidence_help_viewed', { skill });
      action();
    } catch {
      track('learning_evidence_unavailable', { stage: 'help' });
      setActionError('Could not record help usage. Retry to open the explanation.');
    } finally {
      setStarting(false);
    }
  }
  async function startPractice() {
    if (!skill || starting) return;
    setStarting(true);
    setActionError(null);
    try {
      // Refresh before starting: another view/device may have exposed this prompt.
      const fresh = await repos.learningEvidence.read();
      const at = Date.now();
      const next = nextPractice(skill, fresh.events, at, fresh.exposures);
      const assisted = fresh.exposures.some(
        (e) => e.skill === skill && e.kind === 'help' && localDay(e.at) === localDay(at),
      );
      await repos.learningSessions.recordCompleted({
        id: newId(),
        mode: EXPOSURE_MODE,
        startedAt: at,
        endedAt: at,
        itemCount: 0,
        correctCount: 0,
        detail: { v: 1, kind: 'prompt', skill, promptId: next.prompt.id },
      });
      track('learning_evidence_practice_started', {
        skill,
        promptId: next.prompt.id,
        repeat: next.repeat,
      });
      setPractice({ ...next, assisted });
    } catch {
      track('learning_evidence_unavailable', { stage: 'start' });
      setActionError('Could not start practice. Retry when local storage is available.');
    } finally {
      setStarting(false);
    }
  }
  if (query.isPending)
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator accessibilityLabel="Loading notebook" />
      </View>
    );
  if (query.isError)
    return (
      <View className="flex-1 justify-center bg-bg p-6">
        <QueryError onRetry={() => void query.refetch()} />
      </View>
    );
  if (practice && skill)
    return (
      <Practice
        key={`${practice.prompt.id}:${skill}`}
        prompt={practice.prompt}
        repeat={practice.repeat}
        assisted={practice.assisted}
        onBack={() => setPractice(null)}
      />
    );
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      contentContainerClassName="gap-5 p-4"
    >
      <Stack.Screen options={{ title: skill ? SKILLS[skill].title : 'Mistake notebook' }} />
      <Text variant="muted">
        Hotel and exam evidence, followed by short everyday practice. This pilot covers three A1
        distinctions. Retelling reflections below remain separate from established mistakes.
      </Text>
      {!skill && <RetellingNotebookSection />}
      {!skill ? (
        <>
          {summaries.map((s) => (
            <Pressable
              key={s.skill}
              onPress={() => router.push(`/learning-evidence/${s.skill}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${SKILLS[s.skill].title}`}
              className="min-h-12 gap-2 border-b border-border py-4 active:opacity-70"
            >
              <Text variant="title">{SKILLS[s.skill].title}</Text>
              <Text>
                {s.practiced
                  ? `${s.missedItems} distinct missed item${s.missedItems === 1 ? '' : 's'} · ${s.practiced} practiced`
                  : 'No mapped evidence yet. Start with an everyday example.'}
              </Text>
              <Text variant="caption">
                {s.freshUnaided} fresh unaided successes ·{' '}
                {s.sources.length ? s.sources.join(' + ') : 'Offline practice available'}
              </Text>
            </Pressable>
          ))}
          <Text variant="caption">
            Only reviewed item aliases are mapped. {query.data?.unmapped ?? 0} other or unavailable
            responses are outside this pilot. No pass probability is calculated.
          </Text>
        </>
      ) : (
        <>
          <Text variant="heading">{SKILLS[skill].title}</Text>
          <Text>
            {summary?.missedItems ?? 0} distinct missed item{summary?.missedItems === 1 ? '' : 's'}{' '}
            · {summary?.freshUnaided ?? 0} fresh unaided successes
          </Text>
          <Text variant="caption">
            {summary?.assistedSuccess ?? 0} successes with help · {summary?.unknownSuccess ?? 0}{' '}
            with help unknown · {summary?.repeatedSuccess ?? 0} repeated successes
          </Text>
          <Action
            label="Explain the distinction"
            disabled={starting}
            onPress={() => void exposeHelp(() => setExplanation(true))}
          />
          {explanation && <Text>{SKILLS[skill].explanation}</Text>}
          <Action
            label="Show an everyday example"
            disabled={starting}
            onPress={() => void exposeHelp(() => setExample(true))}
          />
          {example && <Text variant="reading">{SKILLS[skill].example}</Text>}
          <Action
            label={
              skill === 'location-destination'
                ? 'Find examples in my reading'
                : 'Open the hotel lessons'
            }
            disabled={starting}
            onPress={() =>
              void exposeHelp(() =>
                router.push(skill === 'location-destination' ? '/grammar-connections' : '/hotel'),
              )
            }
          />
          <Text variant="caption">
            Reading examples use available, spoiler-safe material. The hotel is the fallback when a
            familiar example is not available.
          </Text>
          <Action
            primary
            label={starting ? 'Preparing…' : 'Try an everyday prompt'}
            disabled={starting}
            onPress={() => void startPractice()}
          />
          {actionError && (
            <Text accessibilityRole="alert" className="text-danger">
              {actionError}
            </Text>
          )}
          <Text variant="caption">
            Opening help or examples marks today’s practice assisted, including after a restart.
          </Text>
          <Text variant="caption">
            One context per day. Return tomorrow for a different context; repeating a task never
            counts as fresh transfer.
          </Text>
          <Text variant="title">Evidence trail</Text>
          <Text variant="caption">
            Historic attempts did not record assistance or content version. Their current reviewed
            item mapping can suggest what to practice, but cannot establish unaided transfer.
          </Text>
          {rows
            .filter((r) => r.skill === skill)
            .sort((a, b) => b.at - a.at)
            .slice(0, 20)
            .map((row) => (
              <EvidenceRow key={row.id} row={row} />
            ))}
          {!rows.some((r) => r.skill === skill) && (
            <Text variant="muted">
              No mapped responses yet. Your first saved practice will appear here.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
function EvidenceRow({ row }: { row: LearningEvidence }) {
  return (
    <View className="gap-1 border-b border-border py-3">
      <Text>
        {row.source} · {row.result} · {new Date(row.at).toLocaleDateString()}
      </Text>
      <Text variant="caption">
        Help: {row.assistance} · Grader: {row.grader}
      </Text>
      <Text variant="caption">
        Attempt version: {row.historicalVersion ?? 'unknown'} · Current content:{' '}
        {row.currentVersion ?? 'unavailable'}
      </Text>
      <Text variant="caption" selectable>
        {row.itemKey}
      </Text>
    </View>
  );
}
function Practice({
  prompt,
  repeat,
  assisted,
  onBack,
}: {
  prompt: PracticePrompt;
  repeat: boolean;
  assisted: boolean;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [answer, setAnswer] = React.useState('');
  const [help, setHelp] = React.useState(assisted);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [session] = React.useState(() => ({ id: newId(), startedAt: Date.now() }));
  const pending = React.useRef<CompletedLearningSession | null>(null);
  const [hasPending, setHasPending] = React.useState(false);
  async function save() {
    if (saving || saved || !answer.trim()) return;
    setSaving(true);
    setError(null);
    const endedAt = Date.now();
    const detail = PracticeDetailSchema.parse({
      v: 1,
      skill: prompt.skill,
      promptId: prompt.id,
      context: prompt.context,
      catalogVersion: 1,
      answer,
      correct: gradePractice(prompt, answer),
      assistance: help ? 'help' : 'none',
      exposure: repeat ? 'repeat' : 'first',
      grader: 'exact-match-v1',
    });
    pending.current ??= {
      ...session,
      mode: PRACTICE_MODE,
      endedAt,
      itemCount: 1,
      correctCount: detail.correct ? 1 : 0,
      detail,
    };
    setHasPending(true);
    try {
      await repos.learningSessions.recordCompleted(pending.current);
      setSaved(true);
      track('learning_evidence_practice_completed', {
        skill: prompt.skill,
        promptId: prompt.id,
        correct: detail.correct,
        assisted: help,
        repeat,
        durationMs: pending.current.endedAt - session.startedAt,
      });
      void qc.invalidateQueries({ queryKey: evidenceKey });
    } catch {
      track('learning_evidence_unavailable', { stage: 'save' });
      setError('Your answer was not saved. Retry to keep this same result.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-bg">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 p-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <Stack.Screen options={{ title: 'Everyday practice' }} />
        <Text variant="heading">{SKILLS[prompt.skill].title}</Text>
        <Text variant="caption">
          {repeat ? 'Repeat practice · not fresh evidence' : 'New everyday context'} · exact answer
          check
        </Text>
        <Text>{prompt.instruction}</Text>
        <Text variant="reading">{prompt.sentence}</Text>
        <TextInput
          accessibilityLabel="Russian missing word"
          placeholder="Write the missing word"
          placeholderTextColor={tokens.textMuted}
          value={answer}
          onChangeText={setAnswer}
          editable={!saved && !saving && !hasPending}
          maxLength={500}
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-14 rounded-xl border border-border bg-surface p-4 font-ui text-base text-text"
        />
        {!saved && (
          <Action
            label={help ? 'Explanation shown' : 'Show explanation (marks help used)'}
            disabled={help || saving || !!hasPending}
            onPress={() => {
              void (async () => {
                setSaving(true);
                setError(null);
                const at = Date.now();
                try {
                  await repos.learningSessions.recordCompleted({
                    id: newId(),
                    mode: EXPOSURE_MODE,
                    startedAt: at,
                    endedAt: at,
                    itemCount: 0,
                    correctCount: 0,
                    detail: { v: 1, kind: 'help', skill: prompt.skill, promptId: prompt.id },
                  });
                  setHelp(true);
                  track('learning_evidence_help_viewed', {
                    skill: prompt.skill,
                    promptId: prompt.id,
                  });
                } catch {
                  setError('Could not record help usage. Retry to view the explanation.');
                } finally {
                  setSaving(false);
                }
              })();
            }}
          />
        )}
        {help && <Text>{prompt.explanation}</Text>}
        {!saved && (
          <Action
            primary
            label={saving ? 'Saving…' : hasPending ? 'Retry saving' : 'Check and save answer'}
            disabled={saving || !answer.trim()}
            onPress={() => void save()}
          />
        )}
        {error && (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        )}
        {saved && (
          <View className="gap-3 rounded-xl border border-border bg-surface p-4">
            <Text variant="title">
              {gradePractice(prompt, answer) ? 'Correct' : 'Compare your answer'}
            </Text>
            <Text variant="reading">{prompt.answer}</Text>
            <Text>{prompt.explanation}</Text>
            <Text variant="caption">
              Saved{' '}
              {help
                ? 'with help'
                : repeat
                  ? 'as repeated practice'
                  : 'as an unaided first response'}
              . An exact gap answer is practice evidence, not a full language assessment.
            </Text>
          </View>
        )}
        <Action label={saved ? 'Back to notebook' : 'Leave practice'} onPress={onBack} />
        {!saved && (
          <Text variant="caption">
            Only checked, saved answers enter your notebook. An unfinished answer is not kept.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function Action({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`min-h-12 justify-center rounded-xl px-4 py-3 ${primary ? 'bg-accent' : 'border border-border bg-surface'} ${disabled ? 'opacity-50' : 'active:opacity-70'}`}
    >
      <Text className={`text-center font-ui-medium ${primary ? 'text-bg' : 'text-text'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
