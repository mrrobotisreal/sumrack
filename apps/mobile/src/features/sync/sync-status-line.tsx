import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { useSyncStatus } from './store';

/**
 * The minimal T07 progress surface (ticket item 4): live per-pack download
 * progress while a run is active, and the last run's outcome afterwards —
 * dismissible, never blocking (design §6 offline/error state rules).
 * Rendered on the pack management screen and above the Library list.
 */
export function SyncStatusLine() {
  const { tokens } = useAppTheme();
  const { phase, progress, lastRun, bannerVisible, dismissBanner } = useSyncStatus();

  if (phase === 'checking') {
    return (
      <Row icon="cloud-outline" color={tokens.textMuted}>
        <Text variant="caption">Checking for new content…</Text>
      </Row>
    );
  }

  if (phase === 'downloading' && progress) {
    return (
      <Row icon="cloud-download-outline" color={tokens.accent}>
        <Text variant="caption" numberOfLines={1}>
          Downloading {progress.titleEn} ({progress.packIndex}/{progress.packCount}) · file{' '}
          {Math.min(progress.filesDone + 1, progress.fileCount)}/{progress.fileCount}
        </Text>
      </Row>
    );
  }

  if (!lastRun || !bannerVisible) return null;

  if (lastRun.outcome === 'error') {
    const detail = lastRun.error ?? lastRun.packErrors.map((e) => e.message).join(' · ');
    return (
      <Row icon="warning-outline" color={tokens.danger} onDismiss={dismissBanner}>
        <Text variant="caption" className="text-danger">
          {detail || 'Sync failed — try again.'}
        </Text>
      </Row>
    );
  }

  const installedCount = lastRun.installed.length + lastRun.updated.length;
  const deferred = lastRun.audioDeferred.length;
  if (installedCount === 0 && deferred === 0) return null; // nothing new — stay quiet

  return (
    <Row icon="checkmark-circle-outline" color={tokens.success} onDismiss={dismissBanner}>
      <Text variant="caption">
        {installedCount > 0
          ? `Content updated: ${[...lastRun.installed, ...lastRun.updated].join(', ')}`
          : 'Sync complete'}
        {deferred > 0 ? ' · audio waiting for Wi-Fi' : ''}
      </Text>
    </Row>
  );
}

function Row({
  icon,
  color,
  children,
  onDismiss,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <View className="mt-2 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Ionicons name={icon} size={16} color={color} />
      <View className="flex-1">{children}</View>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={color} />
        </Pressable>
      )}
    </View>
  );
}
