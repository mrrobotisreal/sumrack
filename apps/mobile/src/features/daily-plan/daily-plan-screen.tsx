import { useQueryClient } from '@tanstack/react-query';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import { repos } from '@/db';
import type { CompletedLearningSession } from '@/db/repositories/learning-sessions';
import { useHotelState } from '@/features/hotel/hotel-hooks';
import { useLearningEvidence, evidenceKey } from '@/features/learning-evidence/hooks';
import { localDay, summarizeEvidence } from '@/features/learning-evidence/model';
import { Action } from '@/features/learning-evidence/notebook-screen';
import { SKILLS } from '@/features/learning-evidence/catalog';
import { track } from '@/services/analytics';
import { planKey, usePlanData } from './hooks';
import { capturePlanSubmission } from './submission';
import {
  buildPlan,
  COMPLETE_MODE,
  DEFAULT_OPTIONS,
  EXAM_SKILLS,
  weekCoverage,
  weeklyEvidence,
  type PlanOptions,
  type PlanTask,
} from './model';

export function DailyPlanScreen() {
  const data = usePlanData();
  const evidence = useLearningEvidence();
  const hotel = useHotelState();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [now, setNow] = React.useState(Date.now);
  const [draft, setDraft] = React.useState<PlanOptions | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef<CompletedLearningSession | null>(null);
  const [hasPending, setHasPending] = React.useState(false);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useFocusEffect(
    React.useCallback(() => {
      track('daily_plan_opened');
      setNow(Date.now());
      void qc.invalidateQueries({ queryKey: planKey });
      void qc.invalidateQueries({ queryKey: evidenceKey });
      void qc.invalidateQueries({ queryKey: ['hotel'] });
    }, [qc]),
  );
  const day = localDay(now);
  const latest = data.data?.plans[0];
  const current = data.data?.plans.find((p) => p.detail.day === day);
  const options = draft ?? current?.detail.options ?? latest?.detail.options ?? DEFAULT_OPTIONS;
  const summaries = summarizeEvidence(evidence.data?.events ?? []);
  const hotelHref =
    hotel.action && (hotel.action.kind === 'lesson' || hotel.action.kind === 'exercises')
      ? hotel.action.route
      : null;
  const tasks =
    !draft && current
      ? current.detail.tasks
      : buildPlan({
          now,
          options,
          dueCount: data.data?.dueCount ?? 0,
          microphoneAvailable: data.data?.microphoneAvailable ?? false,
          readingHref: data.data?.readingHref ?? null,
          listeningHref: data.data?.listeningHref ?? null,
          speakingHref: data.data?.speakingHref ?? null,
          hotelHref,
          examDate: data.data?.examDate,
          completions: data.data?.history,
          evidence: summaries,
        });
  const isSaved = !!current && !draft;
  const coverage = weekCoverage(data.data?.history ?? [], now);
  const weekly = weeklyEvidence(evidence.data?.events ?? [], now);
  const nextFocus = [...summaries].sort((a, b) => b.missedItems - a.missedItems)[0];
  function change(patch: Partial<PlanOptions>) {
    if (saving || pending.current) return;
    setDraft({ ...options, ...patch });
    setError(null);
  }
  async function savePlan() {
    if (saving) return;
    setSaving(true);
    setError(null);
    pending.current ??= capturePlanSubmission(options, tasks);
    setHasPending(true);
    try {
      await repos.learningSessions.recordCompleted(pending.current);
      track('daily_plan_saved', {
        minutes: options.minutes,
        goal: options.goal,
        quiet: options.quiet,
        count: tasks.length,
      });
      await qc.invalidateQueries({ queryKey: planKey });
      pending.current = null;
      setHasPending(false);
      setDraft(null);
    } catch {
      track('daily_plan_unavailable', { stage: 'save' });
      setError('The plan was not saved. Retry saving this plan.');
    } finally {
      setSaving(false);
    }
  }
  const completionPending = React.useRef(new Map<string, CompletedLearningSession>());
  async function complete(task: PlanTask, at: number) {
    if (!current || saving || !isSaved) return;
    const key = `plan-complete:${current.id}:${task.id}`;
    if (data.data?.history.some((e) => e.planId === current.id && e.taskId === task.id)) return;
    setSaving(true);
    setError(null);
    const row = completionPending.current.get(key) ?? {
      id: key,
      mode: COMPLETE_MODE,
      startedAt: at,
      endedAt: at,
      itemCount: 0,
      correctCount: 0,
      detail: {
        v: 1,
        planId: current.id,
        taskId: task.id,
        day: localDay(at),
        skill: task.skill,
        minutes: task.minutes,
        provenance: 'self-reported',
      },
    };
    completionPending.current.set(key, row);
    try {
      await repos.learningSessions.recordCompleted(row);
      track('daily_plan_task_completed', {
        planId: current.id,
        taskId: task.id,
        skill: task.skill,
        minutes: task.minutes,
        provenance: 'self-reported',
      });
      await qc.invalidateQueries({ queryKey: planKey });
    } catch {
      track('daily_plan_unavailable', { stage: 'completion' });
      setError('Completion was not saved. Tap the same completion button to retry.');
    } finally {
      setSaving(false);
    }
  }
  if (data.isPending || evidence.isPending)
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator accessibilityLabel="Loading daily plan" />
      </View>
    );
  if (data.isError)
    return (
      <View className="flex-1 justify-center bg-bg p-6">
        <QueryError onRetry={() => void data.refetch()} />
      </View>
    );
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="gap-5 p-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
    >
      <Stack.Screen options={{ title: 'Your daily plan' }} />
      <Text variant="heading">Time for Russian</Text>
      <Text variant="muted">Choose a manageable session. A shorter day creates no backlog.</Text>
      <View className="flex-row flex-wrap gap-2">
        {([15, 30, 60] as const).map((minutes) => (
          <Choice
            key={minutes}
            label={`${minutes} min`}
            selected={options.minutes === minutes}
            disabled={saving || hasPending}
            onPress={() => change({ minutes })}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {(['exam', 'everyday', 'reading'] as const).map((goal) => (
          <Choice
            key={goal}
            label={goal === 'exam' ? 'A1 exam' : goal === 'everyday' ? 'Everyday' : 'Reading'}
            selected={options.goal === goal}
            disabled={saving || hasPending}
            onPress={() => change({ goal })}
          />
        ))}
      </View>
      <View className="min-h-12 flex-row items-center justify-between gap-4">
        <View className="flex-1">
          <Text>Quiet practice</Text>
          <Text variant="caption">Write instead of speaking; skip audio.</Text>
        </View>
        <Switch
          accessibilityLabel="Quiet practice"
          value={options.quiet}
          disabled={saving || hasPending}
          onValueChange={(quiet) => change({ quiet })}
        />
      </View>
      <Text variant="caption">
        {data.data?.examDate
          ? `Your configured A1 exam date: ${data.data.examDate}.`
          : 'No A1 exam date set · ongoing learning.'}{' '}
        Times are estimates. Stop when your chosen time is up.
      </Text>
      {evidence.isError && (
        <View className="gap-2">
          <Text variant="caption">
            Evidence could not be loaded. This plan uses available activities and reported coverage.
          </Text>
          <Action label="Retry notebook evidence" onPress={() => void evidence.refetch()} />
        </View>
      )}
      {!data.data?.readingHref && (
        <Text variant="caption">
          No readable story is installed. Grammar practice and writing are available offline.
        </Text>
      )}
      {!options.quiet && !data.data?.speakingHref && (
        <Text variant="caption">
          Speaking needs an installed scenario with audio. Writing is available now.
        </Text>
      )}
      <Text variant="title">
        {tasks.reduce((n, t) => n + t.minutes, 0)} of {options.minutes} minutes planned
      </Text>
      {!isSaved && (
        <Action
          primary
          label={saving ? 'Saving…' : hasPending ? 'Retry saving plan' : 'Save this plan'}
          disabled={saving}
          onPress={() => void savePlan()}
        />
      )}
      {isSaved && (
        <Text variant="caption">
          Saved for {day}. Opening an activity does not mark it complete.
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {tasks.map((task, index) => {
        const completeAlready =
          !!current &&
          (data.data?.history.some((e) => e.planId === current.id && e.taskId === task.id) ??
            false);
        const available =
          (data.data?.allowedHrefs.has(task.href) || task.href === hotelHref) &&
          !(task.skill === 'speaking' && (options.quiet || !data.data?.microphoneAvailable));
        return (
          <View key={task.id} className="gap-3 border-b border-border pb-5">
            <Text variant="title">
              {index + 1}. {task.title} · {task.minutes} min
            </Text>
            <Text variant="muted">{task.reason}</Text>
            {available ? (
              <Action
                label={`Open ${task.title.toLowerCase()}`}
                disabled={!isSaved || saving}
                onPress={() => {
                  track('daily_plan_task_opened', {
                    planId: current?.id ?? 'unsaved',
                    taskId: task.id,
                  });
                  router.push(task.href as Href);
                }}
              />
            ) : (
              <Text variant="caption">
                This activity is no longer available. Change a choice and save a new plan using
                current content.
              </Text>
            )}
            {isSaved && (
              <Action
                label={
                  completeAlready ? 'Completed · self-reported' : 'I completed this · self-report'
                }
                disabled={completeAlready || saving}
                onPress={() => void complete(task, Date.now())}
              />
            )}
          </View>
        );
      })}
      <Text variant="title">Your last 7 days</Text>
      <Text variant="caption">
        Reported plan completions, not time measured in the activities. Quiet or missing-content
        days can leave gaps.
      </Text>
      <View className="gap-2">
        {EXAM_SKILLS.map((skill) => (
          <View key={skill} className="flex-row justify-between gap-4">
            <Text>
              {skill === 'lexgram'
                ? 'Vocabulary & grammar'
                : skill[0]!.toUpperCase() + skill.slice(1)}
            </Text>
            <Text>{coverage[skill]}</Text>
          </View>
        ))}
      </View>
      <Text>
        {weekly.freshUnaided} fresh unaided practice successes · {weekly.repeated} repeated
        successes · {weekly.missed} distinct missed items
      </Text>
      <Text variant="caption">
        {nextFocus && nextFocus.missedItems > 0
          ? `Next focus: ${SKILLS[nextFocus.skill].title}.`
          : 'Next focus: try one new everyday context, then return another day.'}{' '}
        These are practice observations, not an assessment score.
      </Text>
      <Action label="Open mistake notebook" onPress={() => router.push('/learning-evidence')} />
    </ScrollView>
  );
}
function Choice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${selected ? 'border-accent bg-accent' : 'border-border bg-surface'} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={selected ? 'font-ui-medium text-bg' : 'text-text'}>{label}</Text>
    </Pressable>
  );
}
