import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { usePacks, useStories, useTokenSearch } from '@/db/hooks';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * T03 debug screen — a verification surface, not product UI (real library
 * arrives in T04). Lists imported packs + stories straight from the
 * repositories and exposes an FTS search box. Only reachable from the
 * dev-only link on the Settings screen.
 */
export default function DevDbScreen() {
  const { tokens } = useAppTheme();
  const packs = usePacks();
  const stories = useStories();
  const [query, setQuery] = React.useState('');
  const search = useTokenSearch(query);
  // Built-in FTS smoke test: known fixture lemma «стена» queried as "стена"
  // and ё-folded «чёрный» queried as "черный" — proves FTS5 MATCH works
  // on-device with ё/е tolerance without needing Cyrillic keyboard input.
  const selfTestWall = useTokenSearch('стена');
  const selfTestBlack = useTokenSearch('черный');

  useFocusEffect(
    React.useCallback(() => {
      track('debug_db_opened');
    }, []),
  );

  return (
    <ScrollView className="flex-1 bg-bg px-4 pt-4" contentContainerClassName="pb-12 gap-6">
      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Imported packs ({packs.data?.length ?? '…'})
        </Text>
        <View className="gap-2">
          {packs.data?.map((p) => (
            <View key={p.id} className="rounded-xl border border-border bg-surface p-3">
              <Text className="font-ui-medium">
                {p.titleRu} · {p.titleEn}
              </Text>
              <Text variant="caption">
                {p.id} · v{p.version} · {p.type} · {p.level} · {p.storyCount}{' '}
                {p.storyCount === 1 ? 'story' : 'stories'}
              </Text>
              <Text variant="caption">tags: {p.tags.join(', ') || '—'}</Text>
            </View>
          ))}
          {packs.data?.length === 0 && (
            <Text variant="caption">No packs imported — bootstrap should have run.</Text>
          )}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Stories ({stories.data?.length ?? '…'})
        </Text>
        <View className="gap-2">
          {stories.data?.map((s) => (
            <View
              key={`${s.packId}/${s.id}`}
              className="rounded-xl border border-border bg-surface p-3"
            >
              <Text className="font-ui-medium">{s.titleRu}</Text>
              <Text variant="caption">
                {s.titleEn} · {s.level} · {s.sentenceCount} sentences · pack {s.packId}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          FTS5 token search (ё/е-tolerant)
        </Text>
        <Text variant="caption" className="mb-2">
          Self-test — «стена»: {selfTestWall.data ? `${selfTestWall.data.length} hits` : '…'} ·
          «черный»→ё: {selfTestBlack.data ? `${selfTestBlack.data.length} hits` : '…'}
          {selfTestBlack.data?.[0]?.lemma ? ` (lemma: ${selfTestBlack.data[0].lemma})` : ''}
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => query.trim() && track('debug_db_search', { query })}
          placeholder="Search lemma or surface form… (e.g. стена)"
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-base text-text"
        />
        <View className="mt-2 gap-1">
          {search.data?.slice(0, 20).map((hit) => (
            <View
              key={`${hit.packId}/${hit.sentenceId}/${hit.tokenIndex}`}
              className="flex-row items-baseline gap-2 rounded-lg bg-surface px-3 py-2"
            >
              <Text className="font-reading">{hit.text}</Text>
              <Text variant="caption">
                {hit.lemma ?? '—'} · {hit.translation ?? '—'} · {hit.pos ?? '—'} ·{' '}
                {hit.level ?? '—'} · {hit.sentenceId}
              </Text>
            </View>
          ))}
          {query.trim().length > 0 && search.data?.length === 0 && (
            <Text variant="caption">No matches.</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
