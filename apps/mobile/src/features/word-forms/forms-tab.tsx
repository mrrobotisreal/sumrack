import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useCurrentProfile, useInvalidateWordProfile, useProfileVersions } from '@/db/hooks';
import type { BankItemRow } from '@/db/repositories/bank';
import { isOnline } from '@/features/ai/connectivity';
import { friendlyAiMessage } from '@/features/ai/errors';
import { GenerateSheet } from '@/features/ai/generate-sheet';
import { PROVIDER_LABELS, type AiRunProfile } from '@/features/ai/run-profile';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { initialExpanded, sectionOrder, toggleExpanded } from './format';
import { OverviewStrip } from './overview-strip';
import { profileKeyFor } from './profile-core';
import { generateProfile } from './profile-service';
import { SectionCard } from './section-table';
import { VersionsSheet } from './versions-sheet';

/** §5.4: needs-enrichment words have no profile key. */
export const NEEDS_LEMMA_MESSAGE = 'Add a lemma first (Edit or Enrich)';

type GenState =
  | { phase: 'idle' }
  | { phase: 'loading'; run: AiRunProfile }
  | { phase: 'error'; message: string; run: AiRunProfile };

/**
 * The Forms tab of a bank item (M16/T53, WORD_FORMS §7.2 + §8): no profile →
 * the CTA card → Generate sheet → loading → tables (or a friendly error with
 * Retry — never an automatic retry, the Explain-sheet pattern); with a
 * profile → overview strip + section cards in catalog order, header actions
 * Regenerate and «Versions · N». A profiled word renders fully offline; the
 * CTA and Regenerate are disabled offline with the reason.
 */
export function FormsTab({
  item,
  headword,
  lessonCounts,
}: {
  item: BankItemRow;
  headword: string;
  /** Per-section lesson counts (`useLessonCounts`), undefined while loading. */
  lessonCounts: Record<string, number> | undefined;
}) {
  const { tokens: theme } = useAppTheme();
  const key = React.useMemo(() => profileKeyFor(item), [item]);
  const current = useCurrentProfile(item);
  const versions = useProfileVersions(item);
  const invalidate = useInvalidateWordProfile();

  const [gen, setGen] = React.useState<GenState>({ phase: 'idle' });
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [online, setOnline] = React.useState(true);

  const profile = current.data?.profile ?? null;
  const hasProfile = profile !== null;

  // Connectivity is read on mount and again after every generation attempt
  // (the sheet re-checks on open too — this only drives the disabled looks).
  React.useEffect(() => {
    let cancelled = false;
    void isOnline().then((up) => {
      if (!cancelled) setOnline(up);
    });
    return () => {
      cancelled = true;
    };
  }, [gen.phase]);

  // forms_tab_viewed on focus — once per mount, after the profile query settled.
  const viewedRef = React.useRef(false);
  React.useEffect(() => {
    if (viewedRef.current || (key !== null && current.isPending)) return;
    viewedRef.current = true;
    track('forms_tab_viewed', { kind: item.kind, hasProfile });
  }, [key, current.isPending, item.kind, hasProfile]);

  const runGeneration = React.useCallback(
    (run: AiRunProfile) => {
      if (!key) return;
      setGen({ phase: 'loading', run });
      generateProfile(item, run, { regenerate: hasProfile })
        .then(() => {
          invalidate(key);
          setGen({ phase: 'idle' });
        })
        .catch((err) => {
          setGen({ phase: 'error', message: friendlyAiMessage(err), run });
        });
    },
    [item, key, hasProfile, invalidate],
  );

  // --- needs-lemma word (no key) ------------------------------------------
  if (!key) {
    return (
      <View className="mt-6 items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
        <Ionicons name="help-circle-outline" size={24} color={theme.textMuted} />
        <Text className="text-center font-ui-medium">{NEEDS_LEMMA_MESSAGE}</Text>
        <Text variant="caption" className="text-center">
          Word forms are keyed by the lemma, so the word needs one before it can be profiled.
        </Text>
      </View>
    );
  }

  if (current.isPending) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const sheetTitle = hasProfile
    ? `Regenerate forms for «${headword}»`
    : `Generate forms for «${headword}»`;
  const sheet = (
    <GenerateSheet
      open={sheetOpen}
      purpose="profile"
      title={sheetTitle}
      onClose={() => setSheetOpen(false)}
      onGenerate={(run) => {
        setSheetOpen(false);
        runGeneration(run);
      }}
    />
  );

  // --- in flight / failed --------------------------------------------------
  if (gen.phase === 'loading') {
    return (
      <View className="mt-6 items-center gap-3 rounded-xl border border-border bg-surface px-6 py-10">
        <ActivityIndicator color={theme.accent} />
        <Text variant="caption" className="text-center">
          Asking {PROVIDER_LABELS[gen.run.provider]}… this can take a minute at Best/Ultra
        </Text>
      </View>
    );
  }
  if (gen.phase === 'error') {
    const failedRun = gen.run;
    return (
      <View className="mt-6 items-center gap-3 rounded-xl border border-border bg-surface px-6 py-8">
        <Ionicons name="cloud-offline-outline" size={22} color={theme.textMuted} />
        <Text variant="caption" className="text-center">
          {gen.message}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => runGeneration(failedRun)}
            accessibilityRole="button"
            className="rounded-xl bg-accent px-5 py-2.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-sm">Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => setGen({ phase: 'idle' })}
            accessibilityRole="button"
            className="rounded-xl border border-border px-5 py-2.5 active:bg-surface-2"
          >
            <Text className="font-ui-medium text-sm text-text-muted">
              {hasProfile ? 'Keep current' : 'Dismiss'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- no profile: the CTA card --------------------------------------------
  if (!profile) {
    return (
      <>
        <View className="mt-6 items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
          <Ionicons name="sparkles-outline" size={26} color={theme.accent} />
          <Text className="font-ui-medium text-lg">No forms yet</Text>
          <Text variant="caption" className="text-center">
            Generate the full grammatical profile of this word — conjugations, declensions,
            participles, its word family — once, then it&apos;s yours offline.
          </Text>
          <Pressable
            onPress={() => setSheetOpen(true)}
            disabled={!online}
            accessibilityRole="button"
            accessibilityLabel="Generate forms"
            accessibilityState={{ disabled: !online }}
            className={`mt-3 flex-row items-center gap-2 rounded-xl px-5 py-3 ${
              online ? 'bg-accent active:opacity-80' : 'bg-surface-2'
            }`}
          >
            <Ionicons
              name="sparkles-outline"
              size={16}
              color={online ? theme.text : theme.textMuted}
            />
            <Text className={`font-ui-medium ${online ? 'text-text' : 'text-text-muted'}`}>
              {online ? 'Generate forms' : 'Offline — connect to generate'}
            </Text>
          </Pressable>
        </View>
        {sheet}
      </>
    );
  }

  return (
    <ProfileView
      item={item}
      profileRow={current.data!}
      profile={profile}
      versionCount={versions.data?.length ?? 1}
      lessonCounts={lessonCounts}
      online={online}
      onRegenerate={() => setSheetOpen(true)}
      onVersions={() => setVersionsOpen(true)}
    >
      {sheet}
      <VersionsSheet
        open={versionsOpen}
        item={item}
        versions={versions.data ?? []}
        onClose={() => setVersionsOpen(false)}
        onPromoted={() => invalidate(key)}
      />
    </ProfileView>
  );
}

/** The profiled render: header actions, overview strip, section cards (keyed by profile id via parent). */
function ProfileView({
  item,
  profileRow,
  profile,
  versionCount,
  lessonCounts,
  online,
  onRegenerate,
  onVersions,
  children,
}: {
  item: BankItemRow;
  profileRow: NonNullable<ReturnType<typeof useCurrentProfile>['data']>;
  profile: NonNullable<ReturnType<typeof useCurrentProfile>['data']>['profile'];
  versionCount: number;
  lessonCounts: Record<string, number> | undefined;
  online: boolean;
  onRegenerate: () => void;
  onVersions: () => void;
  children: React.ReactNode;
}) {
  const { tokens: theme } = useAppTheme();
  const sections = React.useMemo(() => sectionOrder(profile!), [profile]);
  const sectionIds = React.useMemo(() => sections.map((s) => s.id), [sections]);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() =>
    initialExpanded(sectionIds),
  );
  // Exactly once per section per mount (ticket technical note).
  const expandedTracked = React.useRef(new Set<string>());
  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = toggleExpanded(prev, id);
      if (next.has(id) && !expandedTracked.current.has(id)) {
        expandedTracked.current.add(id);
        track('forms_section_expanded', { sectionId: id });
      }
      return next;
    });
  }, []);

  return (
    <View className="mt-4 gap-3">
      {/* header actions */}
      <View className="flex-row items-center justify-end gap-2">
        {versionCount > 1 && (
          <Pressable
            onPress={onVersions}
            accessibilityRole="button"
            accessibilityLabel={`Versions, ${versionCount}`}
            className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
          >
            <Ionicons name="layers-outline" size={14} color={theme.textMuted} />
            <Text variant="caption" className="font-ui-medium">
              Versions · {versionCount}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onRegenerate}
          disabled={!online}
          accessibilityRole="button"
          accessibilityLabel={online ? 'Regenerate forms' : 'Regenerate forms, offline'}
          accessibilityState={{ disabled: !online }}
          className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
            online ? 'border-accent/40 active:bg-surface-2' : 'border-border opacity-50'
          }`}
        >
          <Ionicons
            name="refresh-outline"
            size={14}
            color={online ? theme.accent : theme.textMuted}
          />
          <Text
            variant="caption"
            className={`font-ui-medium ${online ? 'text-accent' : 'text-text-muted'}`}
          >
            {online ? 'Regenerate' : 'Regenerate · offline'}
          </Text>
        </Pressable>
      </View>

      <OverviewStrip profile={profile!} />

      {sections.map((section) => (
        <SectionCard
          key={section.id}
          item={item}
          profileRow={profileRow}
          section={section}
          expanded={expanded.has(section.id)}
          onToggle={() => toggle(section.id)}
          lessonCount={lessonCounts?.[section.id] ?? 0}
          online={online}
        />
      ))}

      {children}
    </View>
  );
}
