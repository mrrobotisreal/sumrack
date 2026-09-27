import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { formatBytes } from '@/features/tts/catalog';
import { useAppTheme } from '@/theme/use-app-theme';

import { ASSIST_MODEL } from './assist-catalog';
import { deleteAssistModel, installAssistModel } from './assist-manager';
import { useAssistStore } from './assist-store';

/**
 * Settings → Speech recognition → the assist-model row (T59, design §11):
 * mirrors the T12 ASR row (install with progress, verify, delete with
 * storage accounting) for the optional Whisper model that hears the English
 * word in «Как сказать…?». Rendered directly under the ASR section.
 */
export function AssistSettingsSection() {
  const { tokens } = useAppTheme();
  const { installedBytes, download, downloadError } = useAssistStore();
  const installed = installedBytes != null;

  const install = React.useCallback(() => {
    void installAssistModel().catch(() => {
      // Error already recorded in the store; the row renders it.
    });
  }, []);

  const confirmDelete = React.useCallback(() => {
    const bytes = useAssistStore.getState().installedBytes ?? 0;
    Alert.alert(
      'Delete assist model?',
      `Frees ${formatBytes(bytes)}. Without it, «Как сказать…» in scenarios falls back to the glossary and the online model.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteAssistModel() },
      ],
    );
  }, []);

  return (
    <>
      <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">{ASSIST_MODEL.displayName}</Text>
            <Text variant="caption">
              {installed
                ? `${ASSIST_MODEL.description} · ${formatBytes(installedBytes)} on device`
                : `${ASSIST_MODEL.description} · ${formatBytes(ASSIST_MODEL.archiveBytes)} download`}
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
              accessibilityLabel="Delete assist model"
            >
              <Ionicons name="trash-outline" size={18} color={tokens.textMuted} />
            </Pressable>
          ) : (
            <Pressable
              onPress={install}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Download assist model"
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
        Optional. In «Сценарии», lets «Как сказать …?» hear the English word on-device. Nothing is
        uploaded.
      </Text>
    </>
  );
}
