import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { isAiWireLogOn, setAiWireLog } from './client';
import { ModelSchema } from './config';
import { friendlyAiMessage } from './errors';
import { GenerateSheet } from './generate-sheet';
import {
  DEFAULT_GRAMMAR_PRESET,
  DEFAULT_MODEL_TABLE,
  getGrammarPreset,
  getModelTable,
  MODEL_HINTS,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  QUALITY_LABELS,
  QUALITY_ORDER,
  resolveRun,
  setGrammarPreset,
  setModelTable,
  type AiProvider,
  type AiQuality,
  type AiRunProfile,
  type ModelTable,
} from './run-profile';
import { RunProfileControls } from './run-profile-controls';
import { runChat } from './runner';

type TestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ok'; model: string; effortApplied: boolean }
  | { phase: 'failed'; message: string };

/**
 * Settings → AI → «Grammar & word forms» (WORD_FORMS §4.5, T51): the run
 * profile preset for M16's word profiles + lessons. Provider / Quality /
 * Effort persist immediately; the «Advanced: model ids» disclosure edits
 * the eight-slug table (validated on blur with `ModelSchema` — invalid →
 * red caption, not saved); Test runs the resolved profile end-to-end
 * through `runChat('grammar-key-test', …)`, which is also how a wrong slug
 * surfaces. The five legacy AI features never read any of this.
 */
export function GrammarPresetSection() {
  const { tokens } = useAppTheme();
  const [preset, setPreset] = React.useState<AiRunProfile>(DEFAULT_GRAMMAR_PRESET);
  const [table, setTable] = React.useState<ModelTable>(DEFAULT_MODEL_TABLE);
  const [loaded, setLoaded] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [testState, setTestState] = React.useState<TestState>({ phase: 'idle' });
  const [wireLog, setWireLog] = React.useState(isAiWireLogOn());
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetResult, setSheetResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    void Promise.all([getGrammarPreset(), getModelTable()]).then(([p, t]) => {
      setPreset(p);
      setTable(t);
      setLoaded(true);
    });
  }, []);

  const changePreset = React.useCallback((next: AiRunProfile) => {
    setPreset(next);
    setTestState({ phase: 'idle' });
    void setGrammarPreset(next);
    track('ai_grammar_preset_changed', { ...next, scope: 'default' });
  }, []);

  const saveSlug = React.useCallback(
    (provider: AiProvider, quality: AiQuality, slug: string) => {
      const next: ModelTable = {
        ...table,
        [provider]: { ...table[provider], [quality]: slug },
      };
      setTable(next);
      setTestState({ phase: 'idle' });
      void setModelTable(next).then((ok) => {
        if (ok) track('ai_model_table_edited', { provider, quality });
      });
    },
    [table],
  );

  const test = React.useCallback(() => {
    setTestState({ phase: 'running' });
    void runChat(
      'grammar-key-test',
      {
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        maxTokens: 64,
        timeoutMs: 30_000,
      },
      resolveRun(preset, table),
    )
      .then((result) =>
        setTestState({
          phase: 'ok',
          model: result.model,
          effortApplied: result.effortApplied !== false,
        }),
      )
      .catch((err) => setTestState({ phase: 'failed', message: friendlyAiMessage(err) }));
  }, [preset, table]);

  if (!loaded) return null;

  return (
    <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5">
      <Text variant="caption" className="mb-1 uppercase tracking-wider">
        Grammar & word forms
      </Text>
      <Text variant="caption" className="mb-3">
        Which model generates word profiles and grammar lessons (M16). Journal feedback, enrichment
        and explanations keep the model above.
      </Text>

      <RunProfileControls profile={preset} table={table} onChange={changePreset} />

      <Pressable
        onPress={() => setAdvancedOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedOpen }}
        className="mt-4 flex-row items-center gap-1.5 py-1 active:opacity-70"
      >
        <Ionicons
          name={advancedOpen ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={tokens.textMuted}
        />
        <Text variant="caption" className="uppercase tracking-wider">
          Advanced: model ids
        </Text>
      </Pressable>
      {advancedOpen && (
        <View className="gap-3">
          <Text variant="caption">
            OpenRouter slugs, one per notch. This table is the only place they live — edit when a
            slug drifts, then Test.
          </Text>
          {PROVIDER_ORDER.map((provider) => (
            <View key={provider} className="gap-2">
              <Text className="font-ui-medium text-sm">{PROVIDER_LABELS[provider]}</Text>
              {QUALITY_ORDER.map((quality) => (
                <SlugInput
                  // Keyed by the stored value: a committed edit remounts the input
                  // with the fresh draft (no state-sync effect needed).
                  key={`${provider}:${quality}:${table[provider][quality]}`}
                  label={`${QUALITY_LABELS[quality]} · ${MODEL_HINTS[provider][quality]}`}
                  value={table[provider][quality]}
                  placeholder={DEFAULT_MODEL_TABLE[provider][quality]}
                  onCommit={(slug) => saveSlug(provider, quality, slug)}
                />
              ))}
            </View>
          ))}
        </View>
      )}

      <View className="mt-3 flex-row items-center gap-2">
        <Pressable
          onPress={test}
          disabled={testState.phase === 'running'}
          accessibilityRole="button"
          accessibilityLabel="Test grammar preset"
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

      {__DEV__ && (
        <View className="mt-4 gap-2 border-t border-border pt-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="font-ui-medium text-sm">Dev · log request bodies</Text>
              <Text variant="caption">Redacted (no messages, no headers), this session only</Text>
            </View>
            <Switch
              value={wireLog}
              onValueChange={(on) => {
                setAiWireLog(on);
                setWireLog(on);
              }}
              trackColor={{ false: tokens.surface2, true: tokens.accent }}
              thumbColor={tokens.text}
              accessibilityLabel="Log redacted AI request bodies"
            />
          </View>
          <Pressable
            onPress={() => {
              setSheetResult(null);
              setSheetOpen(true);
            }}
            accessibilityRole="button"
            className="self-start rounded-lg border border-border px-3 py-1.5 active:bg-surface-2"
          >
            <Text variant="caption">Dev · open Generate sheet</Text>
          </Pressable>
          {sheetResult && <Text variant="caption">{sheetResult}</Text>}
          <GenerateSheet
            open={sheetOpen}
            purpose="profile"
            title="Generate forms for «говорить» (dev preview)"
            onClose={() => setSheetOpen(false)}
            onGenerate={(profile, opts) => {
              setSheetOpen(false);
              setSheetResult(
                `Would generate with ${profile.provider} · ${profile.quality} · ${profile.effort}` +
                  (opts.saveAsDefault ? ' (saved as default)' : ''),
              );
              void getGrammarPreset().then(setPreset);
            }}
          />
        </View>
      )}
    </View>
  );
}

/** One model-id input: draft locally, validate + commit on blur, red caption when invalid. */
function SlugInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (slug: string) => void;
}) {
  const { tokens } = useAppTheme();
  const [draft, setDraft] = React.useState(value);
  const [invalid, setInvalid] = React.useState(false);

  const commit = () => {
    const parsed = ModelSchema.safeParse(draft);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed.data !== value) onCommit(parsed.data);
  };

  return (
    <View>
      <Text variant="caption" className="mb-1">
        {label}
      </Text>
      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          if (invalid) setInvalid(false);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={placeholder}
        placeholderTextColor={tokens.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        className={`rounded-xl border bg-surface-2 px-3 py-2 font-ui text-sm text-text ${
          invalid ? 'border-danger' : 'border-border'
        }`}
        accessibilityLabel={`Model id for ${label}`}
      />
      {invalid && (
        <Text variant="caption" className="mt-1 text-danger">
          Not a model id (expected provider/model) — not saved
        </Text>
      )}
    </View>
  );
}
