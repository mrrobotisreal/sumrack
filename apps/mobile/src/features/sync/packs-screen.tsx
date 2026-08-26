import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { removeImportedPack } from '@/features/import/import-service';

import { useInstalledPacks, syncQueryKeys, type InstalledPack } from './hooks';
import { useSyncStatus } from './store';
import { formatBytes } from './sync-core';
import { removeInstalledPack, runSync } from './sync-service';
import { SyncStatusLine } from './sync-status-line';

/**
 * Pack management (ticket item 5): installed packs with version, size,
 * source, last-synced; manual "check now"; per-pack removal. Lives off
 * Settings and the Library header.
 */
export function PacksScreen() {
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const installed = useInstalledPacks();
  const phase = useSyncStatus((s) => s.phase);

  // T28: local (imported) packs list under their own section — no update
  // affordances (sync never touches them), remove = full delete.
  const remote = (installed.data ?? []).filter((i) => i.state.source !== 'local-import');
  const imported = (installed.data ?? []).filter((i) => i.state.source === 'local-import');

  useFocusEffect(
    React.useCallback(() => {
      track('packs_screen_opened');
    }, []),
  );

  const refresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: syncQueryKeys.installedPacks }),
    [queryClient],
  );

  const checkNow = React.useCallback(() => {
    void runSync({ trigger: 'manual' }).then(refresh);
  }, [refresh]);

  const confirmRemove = React.useCallback(
    (item: InstalledPack) => {
      const title = item.pack?.titleRu ?? item.state.packId;
      Alert.alert(
        'Remove pack?',
        `«${title}» will be removed from the device. Your word bank and review history keep working; ` +
          'a pack still published in the content repo reinstalls on the next sync ' +
          '(bundled sample packs reinstall at next app start).',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => void removeInstalledPack(item.state.packId).then(refresh),
          },
        ],
      );
    },
    [refresh],
  );

  // T28: removing an imported pack is a FULL delete (recorded decision) —
  // content, its backed-up pack JSON, and its import request all go; nothing
  // reinstalls it. Distinct confirm copy so that's never a surprise.
  const confirmRemoveImported = React.useCallback(
    (item: InstalledPack) => {
      const title = item.pack?.titleRu ?? item.state.packId;
      Alert.alert(
        'Удалить импорт?',
        `«${title}» will be deleted completely — including its backup copy. It will NOT come back ` +
          'on sync or restore. Word-bank items highlighted from it stay in your bank.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => void removeImportedPack(item.state.packId).then(refresh),
          },
        ],
      );
    },
    [refresh],
  );

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-4 pb-12 pt-4">
      <SyncStatusLine />

      <Pressable
        onPress={checkNow}
        disabled={phase !== 'idle'}
        accessibilityRole="button"
        className={`mb-6 mt-3 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3 ${
          phase !== 'idle' ? 'bg-surface-2' : 'bg-accent active:opacity-80'
        }`}
      >
        {phase !== 'idle' ? (
          <ActivityIndicator size="small" color={tokens.text} />
        ) : (
          <Ionicons name="sync-outline" size={18} color={tokens.text} />
        )}
        <Text className="font-ui-medium">
          {phase !== 'idle' ? 'Syncing…' : 'Check for updates'}
        </Text>
      </Pressable>

      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Installed packs
      </Text>
      {installed.isPending ? (
        <ActivityIndicator color={tokens.accent} className="mt-8" />
      ) : remote.length === 0 ? (
        <View className="items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
          <Ionicons name="cloud-download-outline" size={32} color={tokens.textMuted} />
          <Text variant="muted" className="text-center">
            No packs installed yet. Configure the content repo in Settings, then check for updates.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-border bg-surface">
          {remote.map((item, i) => (
            <PackRowView
              key={item.state.packId}
              item={item}
              first={i === 0}
              onRemove={() => confirmRemove(item)}
            />
          ))}
        </View>
      )}

      {imported.length > 0 && (
        <>
          <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
            Импортировано
          </Text>
          <Text variant="caption" className="mb-2">
            Created on this device from shared text — never updated or removed by sync. Removing one
            deletes it completely, including from backups.
          </Text>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            {imported.map((item, i) => (
              <PackRowView
                key={item.state.packId}
                item={item}
                first={i === 0}
                onRemove={() => confirmRemoveImported(item)}
              />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function PackRowView({
  item,
  first,
  onRemove,
}: {
  item: InstalledPack;
  first: boolean;
  onRemove: () => void;
}) {
  const { tokens } = useAppTheme();
  const { state, pack } = item;
  const synced = new Date(state.updatedAt);
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3.5 ${first ? '' : 'border-t border-border'}`}
    >
      {pack ? <LevelChip level={pack.level} /> : null}
      <View className="flex-1 gap-0.5">
        <Text className="font-ui-medium" numberOfLines={1}>
          {pack?.titleRu ?? state.packId}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          v{state.version} · {formatBytes(state.bytes)} · {sourceLabel(state.source)} ·{' '}
          {synced.toLocaleDateString()}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityLabel={`Remove ${pack?.titleRu ?? state.packId}`}
      >
        <Ionicons name="trash-outline" size={20} color={tokens.textMuted} />
      </Pressable>
    </View>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'bundled':
      return 'bundled';
    case 'github':
      return 'synced';
    case 'local-file':
      return 'local';
    case 'local-import':
      return 'imported';
    default:
      return source;
  }
}
