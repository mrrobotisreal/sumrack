import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  clearApiKey,
  DEFAULT_MODEL,
  getModel,
  hasApiKey,
  MODEL_OPTIONS,
  setApiKey,
  setModel,
} from './config';
import { friendlyAiMessage } from './errors';
import { pumpFeedbackQueue } from './journal-feedback';
import { runChat } from './runner';

/**
 * Settings → AI (design §7.8: "OpenRouter key + model choice"). Follows
 * the T07 sync section conventions exactly: the key input is WRITE-ONLY —
 * the stored value is never read back into the UI, never logged, never in
 * analytics. Model choice is curated Claude ids + a custom field.
 */
export function AiSettingsSection() {
  const { tokens } = useAppTheme();

  const [keyInput, setKeyInput] = React.useState('');
  const [keyConfigured, setKeyConfigured] = React.useState(false);
  const [model, setModelState] = React.useState(DEFAULT_MODEL);
  const [customModel, setCustomModel] = React.useState('');
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [testState, setTestState] = React.useState<
    | { phase: 'idle' }
    | { phase: 'running' }
    | { phase: 'ok' }
    | { phase: 'failed'; message: string }
  >({ phase: 'idle' });
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      setKeyConfigured(await hasApiKey());
      const stored = await getModel();
      setModelState(stored);
      if (!MODEL_OPTIONS.some((option) => option.id === stored)) setCustomModel(stored);
      setLoaded(true);
    })();
  }, []);

  const save = React.useCallback(() => {
    void (async () => {
      const key = keyInput.trim();
      if (key) {
        await setApiKey(key);
        setKeyInput('');
        setKeyConfigured(true);
        track('ai_key_saved'); // deliberately no props — never the value
        // A queued journal entry may only have been waiting for a key.
        void pumpFeedbackQueue();
      }
      const custom = customModel.trim();
      const target = custom || model;
      if (await setModel(target)) {
        setModelState(target);
        track('ai_model_changed', { model: target });
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    })();
  }, [keyInput, customModel, model]);

  const removeKey = React.useCallback(() => {
    void (async () => {
      await clearApiKey();
      setKeyConfigured(false);
      track('ai_key_cleared');
    })();
  }, []);

  const pickModel = React.useCallback((id: string) => {
    setCustomModel('');
    setModelState(id);
    void setModel(id).then((ok) => {
      if (ok) track('ai_model_changed', { model: id });
    });
  }, []);

  const testConnection = React.useCallback(() => {
    setTestState({ phase: 'running' });
    void runChat('key-test', {
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      maxTokens: 10,
      timeoutMs: 20_000,
    })
      .then(() => {
        setTestState({ phase: 'ok' });
        track('ai_key_test', { ok: true });
      })
      .catch((err) => {
        setTestState({ phase: 'failed', message: friendlyAiMessage(err) });
        track('ai_key_test', { ok: false });
      });
  }, []);

  if (!loaded) return null;

  const activeIsCustom = customModel.trim().length > 0;

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        AI · OpenRouter
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5">
        <Text variant="caption" className="mb-1 uppercase tracking-wider">
          API key {keyConfigured ? '· configured ✓' : ''}
        </Text>
        <TextInput
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={keyConfigured ? 'Enter a new key to replace' : 'sk-or-…'}
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="OpenRouter API key"
        />
        <Text variant="caption" className="mt-1.5">
          Powers journal feedback, word enrichment, and explanations. Stored in the Android
          Keystore, never in backups or logs.
        </Text>
        {keyConfigured && (
          <Pressable onPress={removeKey} hitSlop={6} className="mt-2 self-start">
            <Text variant="caption" className="text-danger">
              Remove saved key
            </Text>
          </Pressable>
        )}

        <Text variant="caption" className="mb-1 mt-4 uppercase tracking-wider">
          Model
        </Text>
        {MODEL_OPTIONS.map((option) => {
          const selected = !activeIsCustom && model === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => pickModel(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="flex-row items-center justify-between py-2 active:opacity-70"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium text-sm">{option.label}</Text>
                <Text variant="caption">{option.hint}</Text>
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={selected ? tokens.accent : tokens.textMuted}
              />
            </Pressable>
          );
        })}
        <TextInput
          value={customModel}
          onChangeText={setCustomModel}
          placeholder="Custom model id (provider/model)"
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="mt-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-sm text-text"
          accessibilityLabel="Custom OpenRouter model id"
        />

        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={save}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-text">{savedFlash ? 'Saved ✓' : 'Save'}</Text>
          </Pressable>
          <Pressable
            onPress={testConnection}
            disabled={testState.phase === 'running'}
            accessibilityRole="button"
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
        {testState.phase === 'failed' && (
          <Text variant="caption" className="mt-2 text-danger">
            {testState.message}
          </Text>
        )}
      </View>
    </>
  );
}
