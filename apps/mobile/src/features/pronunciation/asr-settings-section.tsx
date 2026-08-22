import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { formatBytes } from '@/features/tts/catalog';
import { useAppTheme } from '@/theme/use-app-theme';

import { ASR_MODEL } from './asr-catalog';
import { deleteAsrModel, installAsrModel } from './asr-manager';
import { useAsrStore } from './asr-store';

/**
 * Settings → Speech recognition (T12): the ASR model's model-manager entry,
 * visually identical to the T11 voice rows (install with progress, verify,
 * delete with storage accounting) — one model, no selection radio.
 */
export function AsrSettingsSection() {
  const { tokens } = useAppTheme();
  const { installedBytes, download, downloadError } = useAsrStore();
  const installed = installedBytes != null;

  const install = React.useCallback(() => {
    void installAsrModel().catch(() => {
      // Error already recorded in the store; the row renders it.
    });
  }, []);

  const confirmDelete = React.useCallback(() => {
    const bytes = useAsrStore.getState().installedBytes ?? 0;
    Alert.alert(
      'Delete recognition model?',
      `Frees ${formatBytes(bytes)}. Pronunciation practice needs it to score your speech.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteAsrModel() },
      ],
    );
  }, []);

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Speech recognition
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">{ASR_MODEL.displayName}</Text>
            <Text variant="caption">
              {installed
                ? `${ASR_MODEL.description} · ${formatBytes(installedBytes)} on device`
                : `${ASR_MODEL.description} · ${formatBytes(ASR_MODEL.archiveBytes)} download`}
            </Text>
          </View>

          {download ? (
            <Text variant="caption" className="text-accent">
              {download.phase === 'downloading'
                ? `${Math.round(download.progress * 100)}%`
                : download.phase === 'verifying'
                  ? 'Verifying…'
                  : 'Unpacking…'}
            </Text>
          ) : installed ? (
            <Pressable
              onPress={confirmDelete}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete recognition model"
            >
              <Ionicons name="trash-outline" size={18} color={tokens.textMuted} />
            </Pressable>
          ) : (
            <Pressable
              onPress={install}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Download recognition model"
              className="flex-row items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 active:bg-border"
            >
              <Ionicons name="cloud-download-outline" size={16} color={tokens.accent} />
              <Text variant="caption" className="text-accent">
                Get
              </Text>
            </Pressable>
          )}
        </View>

        {download && download.phase === 'downloading' && (
          <View className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
            <View
              className="h-1 rounded-full bg-accent"
              style={{ width: `${Math.max(2, Math.round(download.progress * 100))}%` }}
            />
          </View>
        )}
        {downloadError && !download && (
          <Text variant="caption" className="mx-4 mb-3 text-danger">
            {downloadError} — tap Get to retry
          </Text>
        )}
      </View>
      <Text variant="caption" className="mt-2 px-1">
        Powers pronunciation practice — your speech is scored on-device and never uploaded.
      </Text>
    </>
  );
}
