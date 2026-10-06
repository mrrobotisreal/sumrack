import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { getExamGradingPreset, setExamGradingPreset } from '@/features/torfl/settings';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { friendlyAiMessage } from './errors';
import {
  DEFAULT_MODEL_TABLE,
  getModelTable,
  resolveRun,
  type AiRunProfile,
  type ModelTable,
} from './run-profile';
import { RunProfileControls } from './run-profile-controls';
import { runChat } from './runner';
import { DEFAULT_EXAM_GRADING_PRESET } from '@/features/torfl/settings-core';

type TestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; model: string; effortApplied: boolean }
  | { phase: 'failed'; message: string };

/**
 * Settings → AI → «Exam grading» (T72, TORFL_EXAM_PREP §4.4 + decision 10):
 * the run profile that grades Письмо (and Говорение from T73) — default
 * Anthropic · Normal (Opus 5.5) · effort HIGH, because this number decides
 * whether Mitch feels ready. Provider / Quality / Effort persist at once
 * into `torfl.gradingPreset`; the model-id table is shared with the grammar
 * preset above (edit it there). Test runs the resolved profile end-to-end
 * through `runChat('grammar-key-test', …)` — a wrong slug surfaces here.
 */
export function ExamGradingPresetSection() {
  const { tokens } = useAppTheme();
  const [preset, setPreset] = React.useState<AiRunProfile>(DEFAULT_EXAM_GRADING_PRESET);
  const [table, setTable] = React.useState<ModelTable>(DEFAULT_MODEL_TABLE);
  const [loaded, setLoaded] = React.useState(false);
  const [testState, setTestState] = React.useState<TestState>({ phase: 'idle' });

  React.useEffect(() => {
    void Promise.all([getExamGradingPreset(), getModelTable()]).then(([p, t]) => {
      setPreset(p);
      setTable(t);
      setLoaded(true);
    });
  }, []);

  const changePreset = React.useCallback((next: AiRunProfile) => {
    setPreset(next);
    setTestState({ phase: 'idle' });
    void setExamGradingPreset(next);
    track('ai_grammar_preset_changed', { ...next, scope: 'exam-grading' });
  }, []);

  const test = React.useCallback(() => {
    setTestState({ phase: 'running' });
    void getModelTable()
      .then((fresh) => {
        setTable(fresh);
        return runChat(
          'grammar-key-test',
          {
            messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
            maxTokens: 64,
            timeoutMs: 30_000,
          },
          resolveRun(preset, fresh),
        );
      })
      .then((result) =>
        setTestState({
          phase: 'ok',
          model: result.model,
          effortApplied: result.effortApplied !== false,
        }),
      )
      .catch((err) => setTestState({ phase: 'failed', message: friendlyAiMessage(err) }));
  }, [preset]);

  if (!loaded) return null;

  return (
    <View
      className="mt-3 overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5"
      testID="exam-grading-preset"
    >
      <Text variant="caption" className="mb-1 uppercase tracking-wider">
        Exam grading
      </Text>
      <Text variant="caption" className="mb-3">
        Which model grades the ТРКИ Письмо (and Говорение) rubric. Default: Opus 5.5 at high effort
        — this score tells you whether you are ready, so it gets the careful grader. Model ids come
        from the table above.
      </Text>

      <RunProfileControls profile={preset} table={table} onChange={changePreset} />

      <View className="mt-3 flex-row items-center gap-2">
        <Pressable
          onPress={test}
          disabled={testState.phase === 'running'}
          accessibilityRole="button"
          accessibilityLabel="Test exam grading preset"
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 active:bg-surface-2"
        >
          {testState.phase === 'running' ? (
            <ActivityIndicator size="small" color={tokens.accent} />
          ) : (
            <Ionicons
              name={
                testState.phase === 'ok'
                  ? 'checkmark-circle'
                  : testState.phase === 'failed'
                    ? 'alert-circle-outline'
                    : 'pulse-outline'
              }
              size={15}
              color={
                testState.phase === 'ok'
                  ? tokens.success
                  : testState.phase === 'failed'
                    ? tokens.danger
                    : tokens.text
              }
            />
          )}
          <Text className="font-ui-medium text-sm">
            {testState.phase === 'ok' ? 'Works ✓' : 'Test'}
          </Text>
        </Pressable>
      </View>
      {testState.phase === 'ok' && (
        <Text variant="caption" className="mt-2">
          Served by {testState.model}
          {testState.effortApplied ? '' : ' · effort n/a (provider rejected it)'}
        </Text>
      )}
      {testState.phase === 'failed' && (
        <Text variant="caption" className="mt-2 text-danger">
          {testState.message}
        </Text>
      )}
    </View>
  );
}
