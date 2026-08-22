import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { formatBytes, PIPER_VOICES, SYSTEM_VOICE_ID } from '@/features/tts/catalog';
import { speakWithInfo, stopSpeaking, type SpeakOutcome } from '@/features/tts/service';
import { useTtsStore } from '@/features/tts/store';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

const SAMPLE_TEXT = 'В темноте старого дома кто-то тихо стучит в стену. Ты слышишь это?';

const RATES = [0.7, 0.85, 1, 1.25] as const;

/**
 * Dev "read any text" screen (T11 ticket item 7): manual QA for voices +
 * the on-record latency measurement surface. Speaks arbitrary Russian text
 * through any installed Piper voice or the system fallback and shows which
 * engine ran and the measured call→first-audio latency.
 */
export default function DevTtsScreen() {
  const { tokens } = useAppTheme();
  const { selectedVoiceId, installed, speaking } = useTtsStore();

  const [text, setText] = React.useState(SAMPLE_TEXT);
  const [voiceId, setVoiceId] = React.useState<string | null>(null); // null = app selection
  const [rate, setRate] = React.useState<number>(1);
  const [lastOutcome, setLastOutcome] = React.useState<(SpeakOutcome & { at: number }) | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

  const effectiveVoice = voiceId ?? selectedVoiceId;

  const speak = React.useCallback(() => {
    setBusy(true);
    track('dev_tts_speak', { voiceId: effectiveVoice, rate, chars: text.length });
    void speakWithInfo(text, { voiceId: effectiveVoice, rate })
      .then((outcome) => setLastOutcome({ ...outcome, at: Date.now() }))
      .finally(() => setBusy(false));
  }, [text, effectiveVoice, rate]);

  const voiceOptions = [
    { id: SYSTEM_VOICE_ID, label: 'System', enabled: true },
    ...PIPER_VOICES.map((v) => ({
      id: v.id,
      label: v.displayName,
      enabled: !!installed[v.id],
    })),
  ];

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-6"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Text
      </Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        className="min-h-28 rounded-xl border border-border bg-surface px-4 py-3 font-reading text-lg text-text"
        placeholder="Введите текст…"
        placeholderTextColor={tokens.textMuted}
        textAlignVertical="top"
      />

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Voice
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {voiceOptions.map((option) => {
          const active = effectiveVoice === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={option.enabled ? () => setVoiceId(option.id) : undefined}
              disabled={!option.enabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: !option.enabled }}
              className={
                active
                  ? 'rounded-full bg-accent px-4 py-2'
                  : option.enabled
                    ? 'rounded-full border border-border bg-surface px-4 py-2 active:bg-surface-2'
                    : 'rounded-full border border-border bg-surface px-4 py-2 opacity-40'
              }
            >
              <Text className={active ? 'font-ui-medium text-bg' : 'font-ui-medium'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" className="mt-2">
        Uninstalled voices are dimmed — install them in Settings → Voices &amp; speech.
      </Text>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Rate
      </Text>
      <View className="flex-row gap-2">
        {RATES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRate(r)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rate === r }}
            className={
              rate === r
                ? 'rounded-full bg-accent px-4 py-2'
                : 'rounded-full border border-border bg-surface px-4 py-2 active:bg-surface-2'
            }
          >
            <Text className={rate === r ? 'font-ui-medium text-bg' : 'font-ui-medium'}>{r}×</Text>
          </Pressable>
        ))}
      </View>

      <View className="mt-8 flex-row gap-3">
        <Pressable
          onPress={speak}
          disabled={busy || text.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Speak"
          className={
            busy || text.trim().length === 0
              ? 'flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 opacity-50'
              : 'flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-80'
          }
        >
          <Ionicons name="volume-high" size={18} color={tokens.bg} />
          <Text className="font-ui-medium text-bg">{busy ? 'Starting…' : 'Speak'}</Text>
        </Pressable>
        <Pressable
          onPress={() => void stopSpeaking()}
          accessibilityRole="button"
          accessibilityLabel="Stop"
          className="flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 active:bg-surface-2"
        >
          <Ionicons name="stop" size={18} color={tokens.text} />
          <Text className="font-ui-medium">Stop</Text>
        </Pressable>
      </View>

      {speaking && (
        <View className="mt-4 flex-row items-center gap-2">
          <Ionicons name="pulse" size={16} color={tokens.accent} />
          <Text variant="caption" className="text-accent">
            Speaking (Piper)…
          </Text>
        </View>
      )}

      {lastOutcome && (
        <View className="mt-6 rounded-xl border border-border bg-surface px-4 py-3">
          <Text variant="caption" className="uppercase tracking-wider">
            Last utterance
          </Text>
          <Text className="mt-1">
            Engine: <Text className="font-ui-medium">{lastOutcome.engine}</Text>
            {lastOutcome.engine === 'piper' && lastOutcome.firstAudioMs !== undefined && (
              <Text>
                {' '}
                · first audio in{' '}
                <Text className="font-ui-medium">{lastOutcome.firstAudioMs} ms</Text>
              </Text>
            )}
          </Text>
          {lastOutcome.engine === 'system' && (
            <Text variant="caption" className="mt-1">
              System TTS — no latency measurement (Android reports none).
            </Text>
          )}
        </View>
      )}

      <View className="mt-6 rounded-xl border border-border bg-surface px-4 py-3">
        <Text variant="caption" className="uppercase tracking-wider">
          Installed voices
        </Text>
        {Object.keys(installed).length === 0 ? (
          <Text variant="caption" className="mt-1">
            None — system fallback active.
          </Text>
        ) : (
          Object.entries(installed).map(([id, v]) => (
            <Text key={id} variant="caption" className="mt-1">
              {id} · {formatBytes(v.bytes)}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}
