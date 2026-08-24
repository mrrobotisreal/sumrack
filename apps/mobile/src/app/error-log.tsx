import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import { clearErrorLog, getErrorLog } from '@/services/error-log';
import type { ErrorLogEntry } from '@/services/error-log-core';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Local error log viewer (T22). Shows everything the crash guard, global
 * handlers, and manual logError() calls captured — newest first — so
 * problems can be self-diagnosed without a connected debugger. Includes a
 * deliberate "throw test error" row proving the crash guard works.
 */

function ThrowOnRender(): never {
  throw new Error('Test error from the error log screen — the crash guard caught this.');
}

function EntryRow({ entry }: { entry: ErrorLogEntry }) {
  const [expanded, setExpanded] = React.useState(false);
  const when = new Date(entry.ts).toLocaleString();
  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={`Error at ${when}: ${entry.message}`}
      className="border-t border-border px-4 py-3 active:bg-surface-2"
    >
      <View className="flex-row items-center gap-2">
        <Text variant="caption" className="text-danger">
          {entry.scope}
          {entry.fatal ? ' · fatal' : ''}
        </Text>
        <Text variant="caption">{when}</Text>
      </View>
      <Text className="mt-1" numberOfLines={expanded ? undefined : 2}>
        {entry.message}
      </Text>
      {expanded && entry.stack ? (
        <Text variant="caption" className="mt-2 font-mono text-xs">
          {entry.stack}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function ErrorLogScreen() {
  const { tokens } = useAppTheme();
  const [testCrash, setTestCrash] = React.useState(false);

  const log = useQuery({ queryKey: ['error-log'], queryFn: () => getErrorLog() });

  useFocusEffect(
    React.useCallback(() => {
      track('error_log_viewed');
      void queryClient.invalidateQueries({ queryKey: ['error-log'] });
    }, []),
  );

  if (testCrash) return <ThrowOnRender />;

  const entries = [...(log.data ?? [])].reverse();

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        data={entries}
        keyExtractor={(e, i) => `${e.ts}-${i}`}
        renderItem={({ item }) => <EntryRow entry={item} />}
        contentContainerClassName="pb-12"
        ListHeaderComponent={
          <View className="gap-3 px-4 pb-2 pt-4">
            <Text variant="caption">
              Errors caught by the crash guard and global handlers are recorded here, on this device
              only. Newest first, capped at 200.
            </Text>
            <View className="overflow-hidden rounded-xl border border-border bg-surface">
              <Pressable
                onPress={() => {
                  track('error_test_triggered');
                  setTestCrash(true);
                }}
                accessibilityRole="button"
                className="min-h-12 flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2"
              >
                <View className="flex-1 gap-0.5 pr-3">
                  <Text className="font-ui-medium">Throw a test error</Text>
                  <Text variant="caption">
                    Verifies the crash guard: the app should show the recovery screen, not die
                  </Text>
                </View>
                <Ionicons name="warning-outline" size={20} color={tokens.danger} />
              </Pressable>
              <Pressable
                onPress={() => {
                  clearErrorLog();
                  track('error_log_cleared');
                  void queryClient.invalidateQueries({ queryKey: ['error-log'] });
                }}
                disabled={entries.length === 0}
                accessibilityRole="button"
                className="min-h-12 flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
              >
                <Text className={entries.length === 0 ? 'text-text-muted' : 'font-ui-medium'}>
                  Clear log
                </Text>
                <Ionicons name="trash-outline" size={20} color={tokens.textMuted} />
              </Pressable>
            </View>
            {entries.length > 0 ? (
              <Text variant="caption" className="uppercase tracking-wider">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center px-8 pt-16">
            <Ionicons name="moon-outline" size={28} color={tokens.textMuted} />
            <Text variant="muted" className="mt-3 text-center">
              No errors logged. The void is quiet.
            </Text>
          </View>
        }
      />
    </View>
  );
}
