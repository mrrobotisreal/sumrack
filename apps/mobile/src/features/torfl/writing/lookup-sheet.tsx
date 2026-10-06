import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { TokenSearchHit } from '@/db/repositories/content';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The writing screen's dictionary (T72, TORFL decision 8: a bilingual
 * dictionary is allowed in Письмо). The letter is free text with no token
 * rows behind it, so lookup is a search over every installed pack's tokens
 * (the T24 token FTS, ё/е-tolerant): the word selected in the editor is
 * pre-filled, distinct lemma → translation rows come back. Read-only: no
 * banking from an exam sheet (the reader does that).
 */
export function WritingLookupSheet({
  open,
  initialQuery,
  subtestKind,
  onClose,
}: {
  open: boolean;
  initialQuery: string;
  /** Analytics `exam_lookup_used {subtestKind}` on each query (mocks + practice). */
  subtestKind: string;
  onClose: () => void;
}) {
  // Remount per open so the query starts from the selected word without a sync effect.
  return open ? (
    <LookupBody
      key={initialQuery}
      initialQuery={initialQuery}
      subtestKind={subtestKind}
      onClose={onClose}
    />
  ) : null;
}

function LookupBody({
  initialQuery,
  subtestKind,
  onClose,
}: {
  initialQuery: string;
  subtestKind: string;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = React.useState(initialQuery);
  const deferred = React.useDeferredValue(query);
  const q = deferred.trim();
  const search = useQuery({
    queryKey: ['torfl', 'writing-lookup', q],
    queryFn: async () => {
      const rows = await repos.content.searchTokens(q, 60);
      track('exam_lookup_used', { subtestKind });
      return dedupe(rows);
    },
    enabled: q.length >= 2,
  });
  const hits = q.length >= 2 ? (search.data ?? null) : null;
  const loading = search.isFetching;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View
        className="max-h-[70%] rounded-t-2xl border-t border-border bg-surface px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 16 }}
        testID="writing-lookup"
      >
        <View className="mb-3 flex-row items-center gap-2">
          <Ionicons name="book-outline" size={18} color={tokens.accent} />
          <Text className="flex-1 font-ui-medium text-lg">Словарь</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
          <Ionicons name="search" size={16} color={tokens.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus={initialQuery.length === 0}
            autoCorrect={false}
            autoCapitalize="none"
            placeholder="Слово по-русски или по-английски…"
            placeholderTextColor={tokens.textMuted}
            className="flex-1 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Dictionary query"
            testID="writing-lookup-input"
          />
          {loading && <ActivityIndicator size="small" color={tokens.accent} />}
        </View>
        <ScrollView
          className="mt-3"
          contentContainerClassName="gap-2 pb-2"
          keyboardShouldPersistTaps="handled"
        >
          {hits === null ? (
            <Text variant="caption" className="pt-4 text-center">
              Ищет по словам всех установленных историй — как бумажный словарь на экзамене.
            </Text>
          ) : hits.length === 0 ? (
            <Text variant="caption" className="pt-4 text-center">
              Ничего не нашлось. Попробуй начальную форму слова.
            </Text>
          ) : (
            hits.map((h, i) => (
              <View
                key={`${h.lemma ?? h.text}-${i}`}
                className="flex-row items-baseline gap-3 rounded-xl border border-border bg-bg px-4 py-2.5"
              >
                <Text className="font-reading text-lg">{h.lemma ?? h.text}</Text>
                <Text variant="caption" className="flex-1">
                  {h.translation ?? '—'}
                  {h.pos ? ` · ${h.pos}` : ''}
                </Text>
                {h.level ? <Text variant="caption">{h.level}</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Distinct (lemma, translation) rows, first-seen order. */
export function dedupe(rows: readonly TokenSearchHit[]): TokenSearchHit[] {
  const seen = new Set<string>();
  const out: TokenSearchHit[] = [];
  for (const r of rows) {
    const key = `${(r.lemma ?? r.text).toLowerCase()}\u0000${(r.translation ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
