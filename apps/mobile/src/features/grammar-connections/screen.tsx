import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { repos } from '@/db';
import { newId } from '@/db/ids';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { FORM_TASKS, gradeForm, GrammarAttemptSchema, PILOT_LESSON, PILOT_QUERY } from './model';

export function GrammarConnectionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [taskIndex, setTaskIndex] = React.useState(0);
  const [trigger, setTrigger] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [ownSentence, setOwnSentence] = React.useState('');
  const [help, setHelp] = React.useState(1);
  const [saved, setSaved] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(() => ({ id: newId(), startedAt: Date.now() }));
  const [locked, setLocked] = React.useState(false);
  const pending = React.useRef<Parameters<typeof repos.learningSessions.recordCompleted>[0] | null>(
    null,
  );
  const task = FORM_TASKS[taskIndex] ?? FORM_TASKS[0];
  const history = useQuery({
    queryKey: ['grammar-practice-history'],
    queryFn: () => repos.learningSessions.list('grammar-connection', 10000),
  });
  const lesson = useQuery({
    queryKey: ['grammar-pilot-lesson'],
    queryFn: () => repos.course.getFloor(PILOT_LESSON.packId),
  });
  const unit = lesson.data?.course.units.find((u) => u.id === PILOT_LESSON.unitId);
  const examples = useQuery({
    queryKey: ['grammar-familiar-examples', unit?.grammarQuery],
    queryFn: () => repos.grammarConnections.familiarExamples(unit?.grammarQuery ?? PILOT_QUERY),
  });
  const refreshExamples = examples.refetch;
  useFocusEffect(
    React.useCallback(() => {
      void refreshExamples();
    }, [refreshExamples]),
  );
  React.useEffect(() => {
    track('grammar_connections_opened');
  }, []);

  async function save() {
    if (saving || saved !== null || !answer.trim() || !trigger || !history.data) return;
    setSaving(true);
    setLocked(true);
    setError('');
    const correct = gradeForm(task.id, trigger, answer);
    if (!pending.current) {
      const repeated = history.data.some((row) => row.detail?.taskId === task.id);
      const detail = GrammarAttemptSchema.parse({
        version: 1,
        skillId: 'location-destination',
        taskId: task.id,
        contextId: task.contextId,
        trigger,
        answer,
        ownSentence,
        helpCount: help,
        exposure: repeated ? 'repeat' : 'first',
        grader: 'authored-key',
        productionGrader: 'self-review',
        correct,
      });
      pending.current = {
        ...attempt,
        mode: 'grammar-connection',
        endedAt: Date.now(),
        itemCount: 1,
        correctCount: correct ? 1 : 0,
        detail,
      };
    }
    try {
      await repos.learningSessions.recordCompleted(pending.current);
      setSaved(pending.current.correctCount === 1);
      track('grammar_connection_practice_completed', { taskId: task.id, correct, helpCount: help });
      await queryClient.invalidateQueries({ queryKey: ['grammar-practice-history'] });
    } catch {
      setError('Your answer could not be saved. Retry to keep this same attempt.');
    } finally {
      setSaving(false);
    }
  }

  function next() {
    setTaskIndex((value) => (value + 1) % FORM_TASKS.length);
    setAnswer('');
    setOwnSentence('');
    setTrigger('');
    setHelp(1);
    setSaved(null);
    setError('');
    setAttempt({ id: newId(), startedAt: Date.now() });
    setLocked(false);
    pending.current = null;
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior="height">
      <Stack.Screen options={{ title: 'Где или куда?' }} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="title">A place, or a destination?</Text>
        <Text className="mt-3">
          First decide what you mean. Где? asks where something is. Куда? asks where it is going.
        </Text>
        <View className="my-5 gap-3 border-y border-border py-4">
          <Text className="font-reading text-xl">Он стоит в коридоре.</Text>
          <Text variant="muted">Location → в + prepositional: коридоре.</Text>
          <Text className="font-reading text-xl">Он идёт в коридор.</Text>
          <Text variant="muted">
            Destination → в + accusative: коридор. Motion alone does not choose the case: walking
            around inside a room still describes a location.
          </Text>
        </View>
        {unit ? (
          <Action
            label="Open the hotel explanation"
            onPress={() =>
              router.push({ pathname: '/hotel/[packId]/[unitId]', params: PILOT_LESSON } as never)
            }
          />
        ) : (
          <Text variant="caption">
            Install hotel floor 4 for its full lesson. You can use the explanation and practice here
            offline.
          </Text>
        )}

        <Text variant="heading" className="mb-2 mt-8">
          In your reading
        </Text>
        <Text variant="muted">
          Only passages you have reached, from the two reviewed A1 pilot books.
        </Text>
        {examples.isPending || examples.isFetching ? (
          <ActivityIndicator color={tokens.accent} className="my-4" />
        ) : examples.isError ? (
          <Action label="Retry familiar examples" onPress={() => void examples.refetch()} />
        ) : examples.data?.length ? (
          examples.data.map((example) => (
            <View
              key={`${example.packId}:${example.sentenceId}`}
              className="mt-4 border-b border-border pb-4"
            >
              <Text className="font-reading text-lg">{example.ru}</Text>
              <Text variant="caption" className="mt-1">
                {example.title}
              </Text>
              <Action
                label="View this passage"
                onPress={() => {
                  track('grammar_connection_example_opened', {
                    packId: example.packId,
                    sentenceId: example.sentenceId,
                  });
                  router.push({
                    pathname: '/grammar-connections/example',
                    params: {
                      packId: example.packId,
                      storyId: example.storyId,
                      sentenceId: example.sentenceId,
                    },
                  } as never);
                }}
              />
            </View>
          ))
        ) : (
          <Text className="mt-3">
            No familiar examples yet. Read some of «Дом без конца» or «Высокий Пёс» at A1, then
            return. Updated editions wait for a source check.
          </Text>
        )}

        <Text variant="heading" className="mb-2 mt-8">
          Try a new situation
        </Text>
        <Text>{task.meaning}</Text>
        <Text variant="caption" className="mt-2">
          Practice with the explanation above. Use the mistake notebook for a later independent
          check.
        </Text>
        <View className="my-3 flex-row gap-3">
          {['Где?', 'Куда?'].map((value) => (
            <Pressable
              key={value}
              disabled={saved !== null || saving || locked}
              onPress={() => setTrigger(value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: trigger === value }}
              className={`min-h-12 flex-1 items-center justify-center rounded-xl border px-4 ${trigger === value ? 'border-accent bg-surface-2' : 'border-border'}`}
            >
              <Text>{value}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="mb-3 font-reading text-xl">{task.stem}</Text>
        <TextInput
          value={answer}
          onChangeText={setAnswer}
          editable={saved === null && !saving && !locked}
          accessibilityLabel="Complete the phrase"
          placeholder="Write the form or the whole sentence"
          placeholderTextColor={tokens.textMuted}
          style={{ color: tokens.text, borderColor: tokens.border }}
          className="min-h-12 rounded-xl border px-3 py-3 font-reading text-lg"
        />
        <Text className="mb-2 mt-4">Optional: write your own sentence with the same meaning.</Text>
        <TextInput
          value={ownSentence}
          onChangeText={setOwnSentence}
          editable={saved === null && !saving && !locked}
          multiline
          accessibilityLabel="Your own sentence"
          placeholder="Your sentence — kept for self-review"
          placeholderTextColor={tokens.textMuted}
          style={{ color: tokens.text, borderColor: tokens.border }}
          className="min-h-20 rounded-xl border px-3 py-3 font-reading text-lg"
        />
        <Text variant="caption" className="mt-2">
          Your own sentence is saved for self-review, not automatically graded. This practice does
          not change your flashcards.
        </Text>
        {help > 1 || saved !== null ? (
          <Text className="mt-4">{task.explanation}</Text>
        ) : (
          <Action
            label="Show this answer’s explanation"
            disabled={locked}
            onPress={() => setHelp((n) => n + 1)}
          />
        )}
        {error ? <Text className="mt-3 text-danger">{error}</Text> : null}
        {history.isError ? (
          <Action label="Retry practice history" onPress={() => void history.refetch()} />
        ) : null}
        {saved === null ? (
          <Action
            label={saving ? 'Saving…' : 'Check and save'}
            disabled={saving || !trigger || !answer.trim() || !history.data}
            onPress={() => void save()}
          />
        ) : (
          <View className="mt-4 gap-2">
            <Text>
              {saved
                ? 'The meaning and form match.'
                : 'Compare your meaning and ending with the explanation.'}
            </Text>
            <Text variant="caption">
              {help
                ? 'The explanation is visible on this page. This counts as supported practice.'
                : 'This answer was checked against a reviewed key. It is practice, not an exam result.'}
            </Text>
            <Action label="Try another situation" onPress={next} />
          </View>
        )}
        <Text variant="heading" className="mb-3 mt-8">
          Recent practice
        </Text>
        {(history.data ?? []).slice(0, 5).map((row) => {
          const parsed = GrammarAttemptSchema.safeParse(row.detail);
          if (!parsed.success) return null;
          const result = parsed.data;
          return (
            <View key={row.id} className="mb-4 gap-2 border-b border-border pb-4">
              <Text variant="caption">
                {new Date(row.startedAt).toLocaleDateString()} ·{' '}
                {result.exposure === 'repeat' ? 'Repeated item' : 'First saved attempt'} ·{' '}
                {result.helpCount ? 'Supported' : 'No recorded help'}
              </Text>
              <Text className="font-reading">{result.answer}</Text>
              {result.ownSentence ? (
                <Text className="font-reading">{result.ownSentence}</Text>
              ) : null}
              <Text variant="caption">
                {result.correct
                  ? 'Meaning and form matched the key.'
                  : 'Meaning or form needs another look.'}{' '}
                Your own sentence remains ungraded.
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="mt-3 min-h-12 justify-center rounded-xl border border-border px-4 py-3 active:bg-surface-2"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Text className="font-ui-medium text-accent">{label}</Text>
    </Pressable>
  );
}
