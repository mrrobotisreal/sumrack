import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { CategoryBadge } from '@/components/category-badge';
import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { useGlobalSearch, usePackClassification } from '@/db/hooks';
import type { SentenceSearchHit } from '@/db/repositories/content';
import type { JournalEntryRow, NoteRow } from '@/db/repositories/journal';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { highlightSnippet } from './highlight';

/** Repo-side sentence cap — reaching it means the long tail was cut off. */
const SENTENCE_LIMIT = 80;

/**
 * Global content search (T24, V2 §7.1): one query over the token FTS (T03's
 * ё-folded shadow columns) plus the T15 journal/notes FTS — three sections:
 * story sentences (grouped by story, match highlighted, deep-link into the
 * reader at that sentence), journal entries, and notes. Entirely offline.
 */
export function GlobalSearchScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const [query, setQuery] = React.useState('');
  const deferred = React.useDeferredValue(query);
  const trimmed = deferred.trim();
  // M14 (T46): badge lookups — a Map over usePacks(), no search-query change.
  const classification = usePackClassification();

  const results = useGlobalSearch(trimmed);

  const sentences = React.useMemo(() => results.data?.sentences ?? [], [results.data]);
  const entries = results.data?.entries ?? [];
  const notes = results.data?.notes ?? [];

  // Analytics: query length + result counts only — never the query text.
  React.useEffect(() => {
    if (trimmed && results.data) {
      track('global_search_performed', {
        chars: trimmed.length,
        sentenceHits: results.data.sentences.length,
        entryHits: results.data.entries.length,
        noteHits: results.data.notes.length,
      });
    }
  }, [trimmed, results.data]);

  /** Sentence hits grouped by story, story order = best-rank first appearance. */
  const storyGroups = React.useMemo(() => {
    const groups = new Map<string, { hits: SentenceSearchHit[] }>();
    for (const hit of sentences) {
      const key = `${hit.packId}/${hit.storyId}`;
      const group = groups.get(key) ?? { hits: [] };
      group.hits.push(hit);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [sentences]);

  const hasQuery = trimmed.length > 0;
  const empty =
    hasQuery &&
    !results.isLoading &&
    sentences.length === 0 &&
    entries.length === 0 &&
    notes.length === 0;

  const openSentence = (hit: SentenceSearchHit) => {
    track('global_search_result_opened', { kind: 'sentence' });
    router.push({
      pathname: '/reader/[packId]/[storyId]',
      params: {
        packId: hit.packId,
        storyId: hit.storyId,
        sentenceIdx: String(hit.orderIdx),
        from: 'search',
      },
    });
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="px-4 pt-3">
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            placeholder="Поиск по историям, записям, заметкам…"
            placeholderTextColor={theme.textMuted}
            className="flex-1 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Search all content"
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
            Search every installed story, journal entry, and note. ё/е-tolerant — «черный» finds
            «чёрный».
          </Text>
        ) : empty ? (
          <Text variant="caption" className="pt-10 text-center">
            Ничего не найдено. Nothing matched «{trimmed}».
          </Text>
        ) : (
          <>
            {storyGroups.length > 0 && (
              <Text variant="caption" className="mt-2 uppercase tracking-wider">
                Истории · {sentences.length}
              </Text>
            )}
            {storyGroups.map((group) => {
              const first = group.hits[0]!;
              return (
                <View key={`${first.packId}/${first.storyId}`} className="gap-1.5">
                  <View className="mt-1 flex-row items-center gap-2">
                    <LevelChip level={first.level as CefrLevel} />
                    <CategoryBadge
                      category={classification.get(first.packId)?.category ?? 'stories'}
                      genre={classification.get(first.packId)?.genre ?? null}
                      size="sm"
                    />
                    <Text className="flex-1 font-ui-medium text-sm" numberOfLines={1}>
                      {first.storyTitleRu}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      {first.packTitleRu}
                    </Text>
                  </View>
                  {group.hits.map((hit) => (
                    <SentenceResult
                      key={hit.sentenceId}
                      hit={hit}
                      onPress={() => openSentence(hit)}
                    />
                  ))}
                </View>
              );
            })}
            {sentences.length >= SENTENCE_LIMIT && (
              <Text variant="caption" className="text-center">
                Showing the first {SENTENCE_LIMIT} sentence matches — narrow the query for more.
              </Text>
            )}

            {entries.length > 0 && (
              <Text variant="caption" className="mt-3 uppercase tracking-wider">
                Записи · {entries.length}
              </Text>
            )}
            {entries.map((entry) => (
              <EntryResult
                key={entry.id}
                entry={entry}
                onPress={() => {
                  track('global_search_result_opened', { kind: 'entry' });
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
                  track('global_search_result_opened', { kind: 'note' });
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

function SentenceResult({ hit, onPress }: { hit: SentenceSearchHit; onPress: () => void }) {
  const segments = React.useMemo(
    () => highlightSnippet(hit.ru, hit.matchedTexts),
    [hit.ru, hit.matchedTexts],
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open in reader: ${hit.ru}`}
      className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
    >
      <Text className="font-reading text-sm leading-5" numberOfLines={3}>
        {segments.map((seg, i) =>
          seg.matched ? (
            <Text key={i} className="bg-accent-soft font-reading text-sm text-accent">
              {seg.text}
            </Text>
          ) : (
            seg.text
          ),
        )}
      </Text>
    </Pressable>
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
