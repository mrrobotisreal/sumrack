import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useRunDebrief, useScenario } from '@/db/hooks';
import { SETTING_KEYS } from '@/db/repositories/settings';
import type { Ending } from '@sumrak/schema';
import { isBackupConfigured } from '@/features/backup/config';
import { friendlyBackupMessage } from '@/features/backup/errors';
import { xpForScenarioRun } from '@/features/motivation/xp';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { downloadBundle } from '../recordings/bundle-service';
import { runDirBytes } from '../recordings/paths';
import { formatSize, practiceItems, transcriptText } from './debrief-core';
import type { MediaState } from './attempt-row';
import { TurnCard } from './turn-card';
import { useClipPlayer } from './use-clip-player';

/**
 * The debrief (T63 §10.2, route `app/scenario/debrief/[runId].tsx`): header
 * (family/rung · ending tone · stats strip · XP · pin), turn cards in walk
 * order, footer «Practice these» · «Play again» · «Share transcript». Media
 * states per run: local ⇒ ▶; pruned + bundle uploaded ⇒ one «Download N KB»
 * that restores every attempt at once; pruned + no bundle ⇒ «deleted».
 */

const TONE_ICON: Record<Ending['tone'], React.ComponentProps<typeof Ionicons>['name']> = {
  good: 'checkmark-circle-outline',
  bad: 'skull-outline',
  strange: 'eye-outline',
};

export function DebriefScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const debriefQ = useRunDebrief(runId);
  const debrief = debriefQ.data ?? null;
  const detailQ = useScenario(debrief?.run.packId, debrief?.run.scenarioId);
  const detail = detailQ.data ?? null;
  const clips = useClipPlayer();

  const [popupTarget, setPopupTarget] = React.useState<WordPopupTarget | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [practiced, setPracticed] = React.useState<number | null>(null);
  const [backupHint, setBackupHint] = React.useState(false);

  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (!debrief || openedRef.current) return;
    openedRef.current = true;
    track('scenario_debrief_opened', {
      turns: debrief.turns.length,
      misses: debrief.stats?.misses ?? 0,
      mediaLocal: debrief.run.mediaLocal,
      bundle: debrief.run.mediaBundleState ?? 'none',
    });
    // §12 «backup not configured»: the one-time «Set up backup to keep recordings».
    void (async () => {
      if (await isBackupConfigured()) return;
      const shown = await repos.settings.get<boolean>(SETTING_KEYS.scenarioBackupHintShown);
      if (shown) return;
      setBackupHint(true);
      await repos.settings.set(SETTING_KEYS.scenarioBackupHintShown, true);
    })();
  }, [debrief]);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['scenario-runs'] });
  }, []);

  const togglePin = React.useCallback(() => {
    if (!debrief) return;
    const next = !debrief.run.pinned;
    void repos.scenarios.setPinned(debrief.run.id, next).then(() => {
      track('scenario_run_pinned', { pinned: next });
      invalidate();
    });
  }, [debrief, invalidate]);

  const download = React.useCallback(() => {
    if (!debrief || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    clips.stop();
    void downloadBundle(debrief.run.id)
      .then(() => invalidate())
      .catch((err) => {
        setDownloadError(friendlyBackupMessage(err));
        track('scenario_debrief_download_failed', {
          code: (err as { code?: string })?.code ?? 'unknown',
        });
      })
      .finally(() => setDownloading(false));
  }, [clips, debrief, downloading, invalidate]);

  const practice = React.useMemo(
    () => (debrief && detail ? practiceItems(debrief, detail.turns, detail.glossary) : []),
    [debrief, detail],
  );

  const addPractice = React.useCallback(() => {
    if (!debrief || practice.length === 0 || practiced !== null) return;
    void (async () => {
      let added = 0;
      for (const item of practice) {
        const res = await repos.bank.addWord({
          lemma: item.lemma,
          surface: item.surface,
          translation: item.translation,
          level: debrief.run.level as 'A1' | 'A2' | 'B1' | 'B2' | 'C1',
          sourceStoryId: debrief.run.scenarioId,
          needsEnrichment: item.translation.length === 0,
        });
        if (res.created) added += 1;
      }
      setPracticed(added);
      track('scenario_practice_added', { count: practice.length, created: added });
      for (const key of ['bank-items', 'bank-count', 'bank-word-status', 'bank-item', 'today']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    })();
  }, [debrief, practice, practiced]);

  const share = React.useCallback(() => {
    if (!debrief) return;
    const runtimeById = new Map((detail?.turns ?? []).map((t) => [t.id, t]));
    const ending = detail?.endings.find((e) => e.id === debrief.run.endingId) ?? null;
    const text = transcriptText({
      familyTitle: detail?.scenario.titleRu ?? debrief.run.familyId,
      level: debrief.run.level,
      endingTitle: ending?.title.ru ?? null,
      finishedAt: debrief.run.finishedAt,
      stats: debrief.stats,
      turns: debrief.turns.map((t) => {
        const rt = runtimeById.get(t.turnId);
        const promptId = rt?.say[rt.say.length - 1];
        return {
          hostLine: promptId ? (detail?.lines[promptId]?.sentence?.ru ?? null) : null,
          attempts: t.attempts,
          modelAnswer: rt?.expect?.accept[0] ?? null,
        };
      }),
    });
    track('scenario_transcript_shared', { turns: debrief.turns.length });
    void Share.share({ message: text }).catch(() => undefined);
  }, [debrief, detail]);

  if (debriefQ.isPending || (debrief && detailQ.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (debriefQ.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void debriefQ.refetch()} />
      </View>
    );
  }
  if (!debrief) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Ionicons name="time-outline" size={40} color={tokens.textMuted} />
        <Text className="font-ui-medium text-lg">Run not found</Text>
        <Text variant="muted" className="text-center">
          This run is no longer in the database.
        </Text>
      </View>
    );
  }

  const run = debrief.run;
  const stats = debrief.stats;
  const ending = detail?.endings.find((e) => e.id === run.endingId) ?? null;
  const runtimeById = new Map((detail?.turns ?? []).map((t) => [t.id, t]));
  const media: MediaState = downloading
    ? 'downloading'
    : run.mediaLocal
      ? 'local'
      : run.mediaBundleState === 'uploaded'
        ? 'archived'
        : 'deleted';
  const localBytes = run.mediaLocal ? runDirBytes(run.id) : 0;
  const xp = stats ? xpForScenarioRun(stats) : 0;
  const clean = stats ? stats.turns > 0 && stats.cleanTurns === stats.turns : false;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="px-4 pb-16"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* header */}
        <View className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <View className="flex-row items-start gap-3">
            <View className="flex-1 gap-0.5">
              <RNText className="font-reading text-2xl text-text">
                {detail?.scenario.titleRu ?? run.familyId}
              </RNText>
              <Text variant="caption">
                {detail?.scenario.titleEn ?? ''} · {run.level}
                {run.finishedAt
                  ? ` · ${new Date(run.finishedAt).toLocaleString()}`
                  : ' · not finished'}
              </Text>
            </View>
            <Pressable
              onPress={togglePin}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={run.pinned ? 'Unpin this run' : 'Pin this run (never pruned)'}
              accessibilityState={{ selected: run.pinned }}
              className="h-9 w-9 items-center justify-center rounded-full bg-surface-2 active:bg-border"
            >
              <Ionicons
                name={run.pinned ? 'pin' : 'pin-outline'}
                size={18}
                color={run.pinned ? tokens.accent : tokens.textMuted}
              />
            </Pressable>
          </View>

          {ending && (
            <View className="mt-3 flex-row items-center gap-2">
              <Ionicons name={TONE_ICON[ending.tone]} size={18} color={tokens.accent} />
              <RNText className="flex-1 font-reading text-lg text-text">{ending.title.ru}</RNText>
              <Text variant="caption">{ending.title.en}</Text>
            </View>
          )}

          {stats && (
            <View className="mt-3 flex-row flex-wrap gap-2">
              <Stat label="turns" value={`${stats.cleanTurns}/${stats.turns}`} hint="clean" />
              <Stat label="misses" value={String(stats.misses)} />
              <Stat label="hints" value={String(stats.lifelines)} />
              <Stat label="skips" value={String(stats.skips)} />
              <Stat label="rescues" value={String(stats.rescues)} />
              <Stat
                label="avg"
                value={stats.avgScore === null ? '—' : `${Math.round(stats.avgScore)}%`}
              />
              <Stat label="XP" value={`+${xp}`} hint={clean ? 'clean' : undefined} />
            </View>
          )}

          {/* media line */}
          <View className="mt-3 flex-row items-center gap-2">
            <Ionicons
              name={
                media === 'local'
                  ? 'mic-outline'
                  : media === 'archived'
                    ? 'cloud-download-outline'
                    : media === 'downloading'
                      ? 'cloud-download-outline'
                      : 'mic-off-outline'
              }
              size={14}
              color={tokens.textMuted}
            />
            <Text variant="caption" className="flex-1">
              {media === 'local'
                ? `Recordings on device · ${formatSize(localBytes)}${
                    run.mediaBundleState === 'uploaded'
                      ? ' · backed up'
                      : run.mediaBundleState === 'pending'
                        ? ' · backup pending'
                        : run.mediaBundleState === 'failed'
                          ? ' · backup failed'
                          : ''
                  }${run.pinned ? ' · pinned' : ''}`
                : media === 'archived'
                  ? 'Recordings archived in your backup'
                  : media === 'downloading'
                    ? 'Downloading recordings…'
                    : 'Recordings deleted (not backed up before pruning)'}
            </Text>
            {media === 'archived' && (
              <Pressable
                onPress={download}
                accessibilityRole="button"
                accessibilityLabel="Download this run's recordings"
                className="rounded-full bg-accent px-3 py-1.5 active:opacity-80"
              >
                <Text variant="caption" className="text-bg">
                  Download
                </Text>
              </Pressable>
            )}
          </View>
          {downloadError && (
            <Text variant="caption" className="mt-1 text-danger">
              {downloadError}
            </Text>
          )}
          {backupHint && (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              className="mt-2 flex-row items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 active:opacity-80"
            >
              <Ionicons name="shield-checkmark-outline" size={14} color={tokens.accent} />
              <Text variant="caption" className="flex-1 text-accent">
                Set up backup to keep recordings — they are pruned after 30 days otherwise.
              </Text>
            </Pressable>
          )}
        </View>

        {!detail && (
          <View className="mt-3 rounded-xl border border-border bg-surface px-4 py-3">
            <Text variant="caption">
              The pack is not installed — lines and model answers are hidden; your attempts and
              recordings are still here.
            </Text>
          </View>
        )}

        {/* turns */}
        <View className="mt-3 gap-3">
          {debrief.turns.map((turn, i) => (
            <TurnCard
              key={`${turn.turnId}-${i}`}
              index={i}
              turn={turn}
              runtime={runtimeById.get(turn.turnId) ?? null}
              detail={detail}
              runId={run.id}
              media={media}
              clips={clips}
              onWordPress={setPopupTarget}
              onPlayedAttempt={(ext) => track('scenario_attempt_played', { ext })}
            />
          ))}
        </View>

        {/* footer */}
        <View className="mt-5 gap-3">
          {practice.length > 0 && (
            <Pressable
              onPress={addPractice}
              disabled={practiced !== null}
              accessibilityRole="button"
              accessibilityLabel={`Practice these ${practice.length} words`}
              className={`flex-row items-center justify-center gap-2 rounded-xl py-3.5 ${
                practiced !== null
                  ? 'border border-border bg-surface'
                  : 'bg-accent active:opacity-80'
              }`}
            >
              <Ionicons
                name={practiced !== null ? 'checkmark' : 'bookmark-outline'}
                size={16}
                color={practiced !== null ? tokens.accent : tokens.bg}
              />
              <Text className={`font-ui-medium ${practiced !== null ? 'text-accent' : 'text-bg'}`}>
                {practiced !== null
                  ? `In your bank${practiced < practice.length ? ` (${practice.length - practiced} were already there)` : ''}`
                  : `Practice these · ${practice.length}`}
              </Text>
            </Pressable>
          )}
          {practice.length > 0 && practiced === null && (
            <Text variant="caption" className="-mt-1 text-center">
              {practice.map((p) => p.lemma).join(' · ')}
            </Text>
          )}
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => {
                clips.stop();
                track('scenario_opened', {
                  familyId: run.familyId,
                  level: run.level,
                  from: 'debrief',
                });
                router.replace(`/scenario/${run.packId}/${run.scenarioId}`);
              }}
              disabled={!detail}
              accessibilityRole="button"
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5 ${
                detail ? 'active:bg-surface-2' : 'opacity-50'
              }`}
            >
              <Ionicons name="refresh" size={16} color={tokens.accent} />
              <Text className="font-ui-medium text-accent">Play again</Text>
            </Pressable>
            <Pressable
              onPress={share}
              accessibilityRole="button"
              className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3.5 active:bg-surface-2"
            >
              <Ionicons name="share-social-outline" size={16} color={tokens.accent} />
              <Text className="font-ui-medium text-accent">Share transcript</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <WordPopup target={popupTarget} onClose={() => setPopupTarget(null)} />
    </View>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View className="min-w-[68px] flex-1 items-center gap-0.5 rounded-xl border border-border bg-bg py-2">
      <Text variant="caption" className="uppercase tracking-wider">
        {label}
      </Text>
      <RNText className="font-ui-bold text-lg text-text">{value}</RNText>
      {hint && <Text variant="caption">{hint}</Text>}
    </View>
  );
}
