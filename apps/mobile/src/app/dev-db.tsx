import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { db } from '@/db';
import { queryKeys, usePacks, useStories, useTokenSearch } from '@/db/hooks';
import { importPack, type ImportResult } from '@/db/importer';
import { classifyPack } from '@/features/library/categories';
import { syncQueryKeys } from '@/features/sync/hooks';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * M14 test fixtures (T43) importable on demand from this dev-only screen
 * (T44) so T45/T46 can be verified on the S25 without publishing anything.
 * `require`d lazily inside the handler — the JSON never enters the bundle
 * graph outside this __DEV__ screen. Removal = the ordinary packs screen.
 */
const FIXTURE_PACKS = [
  { id: 'a2-news-090', note: 'news · 2 stories with subtitle + source' },
  { id: 'a2-podcast-090', note: 'podcast · 1 episode' },
  { id: 'a1-comedy-090', note: 'stories/comedy · 1 story, no source' },
] as const;
type FixtureId = (typeof FIXTURE_PACKS)[number]['id'];

const FIXTURE_JSON: Record<FixtureId, () => unknown> = {
  'a2-news-090': () => require('@sumrak/schema/fixtures/packs/a2-news-090/pack.json'),
  'a2-podcast-090': () => require('@sumrak/schema/fixtures/packs/a2-podcast-090/pack.json'),
  'a1-comedy-090': () => require('@sumrak/schema/fixtures/packs/a1-comedy-090/pack.json'),
};

/**
 * T03 debug screen — a verification surface, not product UI (real library
 * arrives in T04). Lists imported packs + stories straight from the
 * repositories and exposes an FTS search box. Only reachable from the
 * dev-only link on the Settings screen.
 */
export default function DevDbScreen() {
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const packs = usePacks();
  const stories = useStories();
  const [query, setQuery] = React.useState('');
  const search = useTokenSearch(query);
  const [fixtureStatus, setFixtureStatus] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<FixtureId | null>(null);

  const importFixture = React.useCallback(
    async (id: FixtureId) => {
      if (!__DEV__ || busy) return;
      setBusy(id);
      try {
        // source 'bundled' (a legal PackSource, same as boot fixtures);
        // origin 'remote' is deliberate — the fixtures must go through the
        // T45 chip filter, not the «Импортировано» shelf.
        const result: ImportResult = await importPack(db, FIXTURE_JSON[id](), {
          source: 'bundled',
          origin: 'remote',
        });
        setFixtureStatus((s) => ({ ...s, [id]: `${result.action} · v${result.version}` }));
        track('debug_fixture_imported', { packId: id });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
          queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
          queryClient.invalidateQueries({ queryKey: syncQueryKeys.installedPacks }),
        ]);
      } catch (err) {
        setFixtureStatus((s) => ({ ...s, [id]: `failed: ${String(err)}` }));
      } finally {
        setBusy(null);
      }
    },
    [busy, queryClient],
  );
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
      {__DEV__ && (
        <View>
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Fixture packs (M14)
          </Text>
          <View className="gap-2">
            {FIXTURE_PACKS.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => void importFixture(f.id)}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={`Import fixture ${f.id}`}
                className={`rounded-xl border border-border p-3 ${
                  busy === f.id ? 'bg-surface-2' : 'bg-surface active:opacity-80'
                }`}
              >
                <Text className="font-ui-medium">
                  {busy === f.id ? 'Importing… ' : 'Import '}
                  {f.id}
                </Text>
                <Text variant="caption">
                  {f.note}
                  {fixtureStatus[f.id] ? ` · ${fixtureStatus[f.id]}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Imported packs ({packs.data?.length ?? '…'})
        </Text>
        <View className="gap-2">
          {packs.data?.map((p) => {
            const c = classifyPack(p);
            return (
              <View key={p.id} className="rounded-xl border border-border bg-surface p-3">
                <Text className="font-ui-medium">
                  {p.titleRu} · {p.titleEn}
                </Text>
                <Text variant="caption">
                  {p.id} · v{p.version} · {p.type} · {p.level} · {p.storyCount}{' '}
                  {p.storyCount === 1 ? 'story' : 'stories'}
                </Text>
                <Text variant="caption">tags: {p.tags.join(', ') || '—'}</Text>
                <Text variant="caption">
                  category: {p.category ?? 'NULL'} · genre: {p.genre ?? 'NULL'} → {c.category}/
                  {c.genre ?? '∅'}
                </Text>
              </View>
            );
          })}
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
              {(s.subtitleRu || s.sourceName) && (
                <Text variant="caption">
                  {s.subtitleRu ? `subtitle: ${s.subtitleRu} · ` : ''}
                  source: {s.sourceName ?? 'NULL'} · url: {s.sourceUrl ?? 'NULL'} · date:{' '}
                  {s.sourcePublishedAt ?? 'NULL'} · author: {s.sourceAuthor ?? 'NULL'}
                </Text>
              )}
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
          onSubmitEditing={() =>
            query.trim() && track('debug_db_search', { chars: query.trim().length })
          }
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
