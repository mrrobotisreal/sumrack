import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatBytes, PIPER_VOICES, SYSTEM_VOICE_ID, type PiperVoice } from './catalog';
import { deleteVoice, installVoice } from './manager';
import { setSelectedVoice } from './service';
import { useTtsStore } from './store';

/**
 * Settings → Voices & speech (T11, design §7.8): the Piper voice manager.
 * Install/delete voices with progress + storage accounting; pick the active
 * voice (or the system TTS fallback). Follows the settings list pattern
 * (UI_DESIGN §4 / T07's sync section).
 */
export function VoicesSettingsSection() {
  const { tokens } = useAppTheme();
  const { selectedVoiceId, installed, downloads, downloadErrors } = useTtsStore();

  const totalBytes = Object.values(installed).reduce((sum, v) => sum + v.bytes, 0);

  const select = React.useCallback((voiceId: string) => {
    void setSelectedVoice(voiceId);
  }, []);

  const download = React.useCallback((voice: PiperVoice) => {
    void installVoice(voice.id)
      .then(() => {
        // First installed voice: switch to it right away — the user
        // downloaded it to hear it, not to configure it twice.
        if (useTtsStore.getState().selectedVoiceId === SYSTEM_VOICE_ID) {
          void setSelectedVoice(voice.id);
        }
      })
      .catch(() => {
        // Error already recorded in the store; the row renders it.
      });
  }, []);

  const confirmDelete = React.useCallback((voice: PiperVoice) => {
    const bytes = useTtsStore.getState().installed[voice.id]?.bytes ?? 0;
    Alert.alert('Delete voice?', `${voice.displayName} frees ${formatBytes(bytes)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteVoice(voice.id);
            if (useTtsStore.getState().selectedVoiceId === voice.id) {
              await setSelectedVoice(SYSTEM_VOICE_ID);
            }
          })();
        },
      },
    ]);
  }, []);

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Voices &amp; speech
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        {/* System TTS — always present, the design §11 safety net. */}
        <Pressable
          onPress={() => select(SYSTEM_VOICE_ID)}
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedVoiceId === SYSTEM_VOICE_ID }}
          className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2"
        >
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">System voice</Text>
            <Text variant="caption">Android TTS fallback — no download needed</Text>
          </View>
          <Ionicons
            name={selectedVoiceId === SYSTEM_VOICE_ID ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={selectedVoiceId === SYSTEM_VOICE_ID ? tokens.accent : tokens.textMuted}
          />
        </Pressable>

        {PIPER_VOICES.map((voice) => {
          const install = installed[voice.id];
          const dl = downloads[voice.id];
          const error = downloadErrors[voice.id];
          const isSelected = selectedVoiceId === voice.id;

          return (
            <View key={voice.id} className="border-t border-border">
              <Pressable
                onPress={install ? () => select(voice.id) : undefined}
                disabled={!install}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: !install }}
                className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2"
              >
                <View className="flex-1 gap-0.5 pr-3">
                  <Text className="font-ui-medium">
                    {voice.displayName}
                    <Text variant="caption"> · Piper</Text>
                  </Text>
                  <Text variant="caption">
                    {install
                      ? `${voice.description} · ${formatBytes(install.bytes)} on device`
                      : `${voice.description} · ${formatBytes(voice.archiveBytes)} download`}
                  </Text>
                </View>

                {dl ? (
                  <Text variant="caption" className="text-accent">
                    {dl.phase === 'downloading'
                      ? `${Math.round(dl.progress * 100)}%`
                      : dl.phase === 'verifying'
                        ? 'Verifying…'
                        : 'Unpacking…'}
                  </Text>
                ) : install ? (
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      onPress={() => confirmDelete(voice)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${voice.displayName}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={tokens.textMuted} />
                    </Pressable>
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? tokens.accent : tokens.textMuted}
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => download(voice)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Download ${voice.displayName}`}
                    className="flex-row items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 active:bg-border"
                  >
                    <Ionicons name="cloud-download-outline" size={16} color={tokens.accent} />
                    <Text variant="caption" className="text-accent">
                      Get
                    </Text>
                  </Pressable>
                )}
              </Pressable>

              {dl && dl.phase === 'downloading' && (
                <View className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
                  <View
                    className="h-1 rounded-full bg-accent"
                    style={{ width: `${Math.max(2, Math.round(dl.progress * 100))}%` }}
                  />
                </View>
              )}
              {error && !dl && (
                <Text variant="caption" className="mx-4 mb-3 text-danger">
                  {error} — tap Get to retry
                </Text>
              )}
            </View>
          );
        })}
      </View>
      <Text variant="caption" className="mt-2 px-1">
        {totalBytes > 0
          ? `Voices use ${formatBytes(totalBytes)} of storage. Downloaded voices speak fully offline.`
          : 'Piper voices speak fully offline once downloaded (~67 MB each).'}
      </Text>
    </>
  );
}
