import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useJournalSearch } from '@/db/hooks';
import type { JournalEntryRow, NoteRow } from '@/db/repositories/journal';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Журнал search (T15, design §5): one query over both FTS indexes —
 * journal_fts (entry text) and notes_fts (title + body). ё/е-tolerant via
 * the repositories' normalized match queries; last term prefix-matched so
 * results appear while typing.
 */
export function JournalSearchScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const [query, setQuery] = React.useState('');
  const deferred = React.useDeferredValue(query);

  const results = useJournalSearch(deferred.trim());

  React.useEffect(() => {
    if (deferred.trim()) track('journal_search', { chars: deferred.trim().length });
  }, [deferred]);

  const entries = results.data?.entries ?? [];
  const notes = results.data?.notes ?? [];
  const hasQuery = deferred.trim().length > 0;

  return (
    <View className="flex-1 bg-bg">
      <View className="px-4 pt-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Поиск по записям и заметкам…"
            placeholderTextColor={theme.textMuted}
            className="flex-1 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Search journal and notes"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerClassName="pb-16 gap-2"
        keyboardShouldPersistTaps="handled"
      >
        {!hasQuery ? (
          <Text variant="caption" className="pt-10 text-center">
            Search matches Russian text with ё/е tolerance.
          </Text>
        ) : entries.length === 0 && notes.length === 0 && !results.isLoading ? (
          <Text variant="caption" className="pt-10 text-center">
            Ничего не найдено. Nothing matched «{deferred.trim()}».
          </Text>
        ) : (
          <>
            {entries.length > 0 && (
              <Text variant="caption" className="mt-2 uppercase tracking-wider">
                Записи · {entries.length}
              </Text>
            )}
            {entries.map((entry) => (
              <EntryResult
                key={entry.id}
                entry={entry}
                onPress={() => {
                  track('journal_search_result_opened', { kind: 'entry' });
                  router.push({ pathname: '/journal/[id]', params: { id: entry.id } });
                }}
              />
            ))}
            {notes.length > 0 && (
              <Text variant="caption" className="mt-3 uppercase tracking-wider">
                Заметки · {notes.length}
              </Text>
            )}
            {notes.map((note) => (
              <NoteResult
                key={note.id}
                note={note}
                onPress={() => {
                  track('journal_search_result_opened', { kind: 'note' });
                  router.push({ pathname: '/notes/[id]', params: { id: note.id } });
                }}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function snippet(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EntryResult({ entry, onPress }: { entry: JournalEntryRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
    >
      <Text variant="caption" className="font-ui-medium">
        {formatDate(entry.createdAt)}
      </Text>
      <Text className="mt-1 font-reading text-sm leading-5" numberOfLines={2}>
        {snippet(entry.ru)}
      </Text>
    </Pressable>
  );
}

function NoteResult({ note, onPress }: { note: NoteRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
    >
      <Text className="font-ui-medium text-sm" numberOfLines={1}>
        {note.title}
      </Text>
      {note.body.trim() ? (
        <Text variant="caption" className="mt-1" numberOfLines={2}>
          {snippet(note.body)}
        </Text>
      ) : null}
    </Pressable>
  );
}
