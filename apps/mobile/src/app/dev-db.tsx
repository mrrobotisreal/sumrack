import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { db, repos } from '@/db';
import { queryKeys, usePacks, useStories, useTokenSearch } from '@/db/hooks';
import { importPack, type ImportResult } from '@/db/importer';
import type { WordProfileRow } from '@/db/repositories/word-forms';
import { friendlyAiMessage } from '@/features/ai/errors';
import {
  getGrammarPreset,
  PROVIDER_LABELS,
  QUALITY_LABELS,
  EFFORT_LABELS,
} from '@/features/ai/run-profile';
import { classifyPack } from '@/features/library/categories';
import { generateProfile } from '@/features/word-forms/profile-service';
import { detectRuDatePath, formatRuDate } from '@/lib/ru-date';
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
/** T52 dev readout state: counts + the last 5 receipts, refreshed on focus and after a run. */
interface WordProfileReadout {
  profiles: { total: number; current: number; keys: number };
  lessons: number;
  withoutProfile: number;
  recent: WordProfileRow[];
}

function formatReceipt(r: WordProfileRow): string {
  const tokens = `${r.promptTokens ?? '?'}+${r.completionTokens ?? '?'}${
    r.reasoningTokens ? ` (r${r.reasoningTokens})` : ''
  } tok`;
  const cost = r.costUsd == null ? 'cost ?' : `$${r.costUsd.toFixed(4)}`;
  return `${r.headword} · ${r.pos} · ${r.provider} · ${r.model} · ${r.quality} · ${r.effort}${
    r.effortApplied ? '' : ' (effort n/a)'
  } · ${tokens} · ${cost} · ${(r.durationMs / 1000).toFixed(1)} s · ${r.isCurrent ? 'current' : 'old'}`;
}

export default function DevDbScreen() {
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  // --- T52 «Word profiles» readout ---------------------------------------
  const [readout, setReadout] = React.useState<WordProfileReadout | null>(null);
  const [profileLog, setProfileLog] = React.useState<string[]>([]);
  const [profileBusy, setProfileBusy] = React.useState(false);
  const refreshReadout = React.useCallback(async () => {
    const [profiles, lessons, withoutProfile, recent] = await Promise.all([
      repos.wordForms.countProfiles(),
      repos.wordForms.countLessons(),
      repos.wordForms.countItemsWithoutProfile(),
      repos.wordForms.listRecentProfiles(5),
    ]);
    setReadout({ profiles, lessons, withoutProfile, recent });
  }, []);
  const generateForNewest = React.useCallback(async () => {
    if (!__DEV__ || profileBusy) return;
    setProfileBusy(true);
    const log = (line: string) => setProfileLog((l) => [...l.slice(-11), line]);
    try {
      const [newest] = await repos.bank.listItems(
        { limit: 1 },
        { key: 'added-desc', familiarity: 'least' },
      );
      if (!newest) {
        log('bank is empty — add a word first');
        return;
      }
      const preset = await getGrammarPreset();
      log(
        `→ «${newest.kind === 'word' ? (newest.lemma ?? newest.surface) : newest.surface}» (${newest.kind}) with ${PROVIDER_LABELS[preset.provider]} / ${QUALITY_LABELS[preset.quality]} / ${EFFORT_LABELS[preset.effort]}…`,
      );
      const started = Date.now();
      const result = await generateProfile(newest, preset);
      log(
        `✓ ${result.profile.pos} · ${result.profile.sections.length} sections · ${((Date.now() - started) / 1000).toFixed(1)} s${result.corrected ? ' · corrected once' : ''} · row ${result.row.id}`,
      );
      log(
        result.warnings.length === 0
          ? 'soft warnings: none'
          : `soft warnings (${result.warnings.length}): ${result.warnings.slice(0, 6).join(' | ')}${result.warnings.length > 6 ? ' | …' : ''}`,
      );
      await refreshReadout();
    } catch (err) {
      log(`✗ ${friendlyAiMessage(err)}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileBusy, refreshReadout]);
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
      void refreshReadout();
    }, [refreshReadout]),
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
          {/* T45: which caption-date path this Hermes build takes (recorded in the ticket row). */}
          <Text variant="caption" className="mt-2">
            formatRuDate path: {detectRuDatePath()} · 2026-09-14 → {formatRuDate('2026-09-14')}
          </Text>
        </View>
      )}

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Word profiles (M16 · T52)
        </Text>
        <Text variant="caption">
          profiles:{' '}
          {readout
            ? `${readout.profiles.total} rows · ${readout.profiles.current} current · ${readout.profiles.keys} keys`
            : '…'}{' '}
          · lessons: {readout?.lessons ?? '…'} · bank items without a profile:{' '}
          {readout?.withoutProfile ?? '…'}
        </Text>
        {__DEV__ && (
          <Pressable
            onPress={() => void generateForNewest()}
            disabled={profileBusy}
            accessibilityRole="button"
            accessibilityLabel="Generate profile for the newest bank word"
            className={`mt-2 rounded-xl border border-border p-3 ${
              profileBusy ? 'bg-surface-2' : 'bg-surface active:opacity-80'
            }`}
          >
            <Text className="font-ui-medium">
              {profileBusy ? 'Generating…' : 'Generate for the newest bank word'}
            </Text>
            <Text variant="caption">
              Runs the T52 service with the Settings → AI «Grammar & word forms» preset; prints the
              validator&apos;s soft warnings.
            </Text>
          </Pressable>
        )}
        {profileLog.length > 0 && (
          <View className="mt-2 gap-1 rounded-xl bg-surface px-3 py-2">
            {profileLog.map((line, i) => (
              <Text key={`${i}-${line.slice(0, 12)}`} variant="caption" selectable>
                {line}
              </Text>
            ))}
          </View>
        )}
        <Text variant="caption" className="mt-2">
          Last 5 receipts
        </Text>
        <View className="mt-1 gap-1">
          {readout?.recent.map((r) => (
            <Text
              key={r.id}
              variant="caption"
              selectable
              className="rounded-lg bg-surface px-3 py-2"
            >
              {formatReceipt(r)}
            </Text>
          ))}
          {readout && readout.recent.length === 0 && (
            <Text variant="caption">No profiles yet.</Text>
          )}
        </View>
      </View>

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
