import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ImportRequestRow } from '@/db/repositories/imports';
import { useAppTheme } from '@/theme/use-app-theme';

import { useImportRequests } from './hooks';
import { stubAnnotateAndCommit } from './import-service';

/**
 * ⚠️ DEV-ONLY, TEMPORARY (T28 scope item 6): stub-annotate queued import
 * requests so the full local-pack lifecycle (commit → shelf → reader →
 * bank → sync immunity → backup round-trip) is provable before T29 ships
 * the real AI annotation. The stub does a rule-based sentence split with
 * surface-as-lemma tokens and NO translations. T29 replaces this screen's
 * job entirely; reached only from Settings → Developer.
 */
export function DevImportScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const requests = useImportRequests();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const stubCommit = React.useCallback(
    (row: ImportRequestRow) => {
      setBusyId(row.id);
      void (async () => {
        try {
          const { packId } = await stubAnnotateAndCommit(row.id);
          Alert.alert(
            'Stub-committed',
            `Pack "${packId}" is installed on the Импортировано shelf.`,
            [
              { text: 'OK' },
              { text: 'Open Library', onPress: () => router.push('/(tabs)/library') },
            ],
          );
        } catch (err) {
          Alert.alert('Stub commit failed', err instanceof Error ? err.message : 'Unknown error');
        } finally {
          setBusyId(null);
        }
      })();
    },
    [router],
  );

  const pending = (requests.data ?? []).filter((r) => r.status !== 'committed');
  const committed = (requests.data ?? []).filter((r) => r.status === 'committed');

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-4 pb-12 pt-4">
      <View className="mb-4 rounded-xl border border-accent/40 bg-surface px-4 py-3">
        <Text className="font-ui-medium text-accent">Dev-only stub annotator</Text>
        <Text variant="caption">
          Temporary T28 tool: commits a request as a minimal pack (sentence split, surface-as-lemma,
          no translations). The real AI annotation + review flow is T29.
        </Text>
      </View>

      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Pending requests
      </Text>
      {requests.isPending ? (
        <ActivityIndicator color={tokens.accent} className="mt-6" />
      ) : pending.length === 0 ? (
        <View className="items-center gap-2 rounded-xl border border-border bg-surface px-6 py-8">
          <Ionicons name="download-outline" size={28} color={tokens.textMuted} />
          <Text variant="muted" className="text-center">
            No pending import requests. Create one via Библиотека → Импорт (or share text to
            Сумрак).
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-border bg-surface">
          {pending.map((row, i) => (
            <View
              key={row.id}
              className={`gap-2 px-4 py-3 ${i === 0 ? '' : 'border-t border-border'}`}
            >
              <View className="gap-0.5">
                <Text className="font-ui-medium" numberOfLines={1}>
                  {row.title}
                </Text>
                <Text variant="caption" numberOfLines={2}>
                  {row.status} · {row.text.length} chars
                  {row.sourceLabel ? ` · ${row.sourceLabel}` : ''}
                  {row.error ? ` · ${row.error}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => stubCommit(row)}
                disabled={busyId !== null}
                accessibilityRole="button"
                className={`flex-row items-center justify-center gap-2 rounded-lg px-3 py-2 ${
                  busyId === null ? 'bg-accent active:opacity-80' : 'bg-surface-2'
                }`}
              >
                {busyId === row.id ? (
                  <ActivityIndicator size="small" color={tokens.text} />
                ) : (
                  <Ionicons name="construct-outline" size={16} color={tokens.text} />
                )}
                <Text className="font-ui-medium text-sm">Stub annotate & commit</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {committed.length > 0 && (
        <>
          <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
            Committed
          </Text>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            {committed.map((row, i) => (
              <View
                key={row.id}
                className={`flex-row items-center gap-3 px-4 py-3 ${i === 0 ? '' : 'border-t border-border'}`}
              >
                <Ionicons name="checkmark-circle" size={16} color={tokens.accent} />
                <View className="flex-1 gap-0.5">
                  <Text className="font-ui-medium" numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {row.packId}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}
