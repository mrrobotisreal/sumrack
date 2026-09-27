import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
} from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useScenarios } from '@/db/hooks';
import { SETTING_KEYS } from '@/db/repositories/settings';
import type { ScenarioFamily, ScenarioRung } from '@/db/repositories/scenarios';
import { ASR_MODEL } from '@/features/pronunciation/asr-catalog';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { haptics } from './haptics';
import { HostThumb, rungSceneSpec } from './host-thumb';
import { useHubGates, type HubGate } from './hub-gates';
import { familyLead, isResumable, rungChipState } from './hub-selection';

/**
 * The «Сценарии» hub (T62, SPEAKING_SCENARIOS §9.1): families as cards (RU
 * title + EN subtitle, the scene's accent stripe, the host thumbnail), rung
 * chips (✓ finished once, ★ clean), «Continue» when a resumable run exists,
 * «Runs · N» (T63's list — a stub until then). The two gates render HERE
 * (ASR model missing → Settings → Speech; mic denied → system settings) and
 * disable every Start; nothing gates mid-run (§12). A one-time banner
 * offers the Whisper assist model.
 */
export function ScenariosHubScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens: theme } = useAppTheme();
  const families = useScenarios();
  const gates = useHubGates();

  const bannerDismissed = useQuery({
    queryKey: ['scenario-assist-banner-dismissed'],
    queryFn: async () =>
      (await repos.settings.get<boolean>(SETTING_KEYS.scenarioAssistBannerDismissed)) === true,
  });

  useFocusEffect(
    React.useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    }, [queryClient]),
  );
  const trackedRef = React.useRef(false);
  React.useEffect(() => {
    if (trackedRef.current || !families.data) return;
    trackedRef.current = true;
    track('scenario_hub_opened', {
      families: families.data.length,
      gate: gates.gate ?? 'none',
    });
  }, [families.data, gates.gate]);

  const dismissBanner = React.useCallback(() => {
    track('scenario_assist_banner', { action: 'dismiss' });
    void repos.settings.set(SETTING_KEYS.scenarioAssistBannerDismissed, true);
    queryClient.setQueryData(['scenario-assist-banner-dismissed'], true);
  }, [queryClient]);

  const start = React.useCallback(
    async (rung: ScenarioRung, from: 'card' | 'continue') => {
      if (gates.gate) return;
      if (gates.mic !== 'granted') {
        const p = await gates.requestMic();
        if (p !== 'granted') return; // the gate re-renders from the new state
      }
      haptics.select();
      track('scenario_opened', { familyId: rung.familyId, level: rung.level, from });
      router.push(`/scenario/${rung.packId}/${rung.id}`);
    },
    [gates, router],
  );

  if (families.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (families.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void families.refetch()} />
      </View>
    );
  }

  const items = families.data ?? [];
  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
        <Ionicons name="radio-outline" size={40} color={theme.textMuted} />
        <Text className="font-reading-bold text-xl">Пока тихо</Text>
        <Text variant="muted" className="text-center">
          No scenario packs installed yet. They arrive through content sync like any pack — pull to
          refresh in Библиотека.
        </Text>
      </View>
    );
  }

  const showBanner =
    gates.gate === null && !gates.assistInstalled && bannerDismissed.data === false;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-3 px-4 pb-12 pt-4">
      {gates.gate && <GateCard gate={gates.gate} />}
      {showBanner && (
        <View className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <Ionicons name="language-outline" size={20} color={theme.accent} />
          <View className="flex-1 gap-0.5">
            <Text className="font-ui-medium">Want to ask «как сказать…» in English?</Text>
            <Text variant="caption">
              Install the assist model — the host will hear the English word inside your question.
            </Text>
            <Pressable
              onPress={() => {
                track('scenario_assist_banner', { action: 'settings' });
                router.push('/settings');
              }}
              accessibilityRole="button"
              className="mt-1 self-start active:opacity-70"
            >
              <Text className="font-ui-medium text-accent">Settings → Assist model</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={dismissBanner}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Ionicons name="close" size={16} color={theme.textMuted} />
          </Pressable>
        </View>
      )}

      {items.map((family) => (
        <FamilyCard
          key={family.familyId}
          family={family}
          disabled={gates.gate !== null}
          onStart={(rung) => void start(rung, 'card')}
          onContinue={(rung) => void start(rung, 'continue')}
          onRuns={(rung) => {
            track('scenario_runs_list_opened', { scenarioId: rung.id, runs: rung.runCount });
            router.push({ pathname: '/scenarios/runs', params: { scenarioId: rung.id } });
          }}
        />
      ))}

      <Text variant="caption" className="mt-3 px-1 text-center">
        Someone talks to you — you answer out loud, in Russian, with no text. Ask «повтори»,
        «помедленнее», «что значит…» or «как сказать…» any time. Subtitles and the mic gesture live
        in Settings → Scenarios.
      </Text>
    </ScrollView>
  );
}

function GateCard({ gate }: { gate: NonNullable<HubGate> }) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const mb = Math.round(ASR_MODEL.archiveBytes / 1_000_000);
  return (
    <View className="gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3.5">
      <View className="flex-row items-center gap-2">
        <Ionicons
          name={gate === 'asr-missing' ? 'cloud-download-outline' : 'mic-off-outline'}
          size={18}
          color={theme.accent}
        />
        <Text className="font-ui-medium">
          {gate === 'asr-missing' ? 'Speech model needed' : 'Microphone access needed'}
        </Text>
      </View>
      <Text variant="caption">
        {gate === 'asr-missing'
          ? `Scenarios are judged offline by the Russian speech model (${mb} MB). Install it once; everything else stays on the device.`
          : 'Нет доступа к микрофону — scenarios are spoken, so the mic is the whole game. Allow it in the system settings, then come back.'}
      </Text>
      <Pressable
        onPress={() => {
          if (gate === 'asr-missing') router.push('/settings');
          else void Linking.openSettings();
        }}
        accessibilityRole="button"
        className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-80"
      >
        <Ionicons
          name={gate === 'asr-missing' ? 'settings-outline' : 'open-outline'}
          size={15}
          color={theme.bg}
        />
        <Text className="font-ui-medium text-bg">
          {gate === 'asr-missing' ? `Install the speech model (${mb} MB)` : 'Open system settings'}
        </Text>
      </Pressable>
    </View>
  );
}

function FamilyCard({
  family,
  disabled,
  onStart,
  onContinue,
  onRuns,
}: {
  family: ScenarioFamily;
  disabled: boolean;
  onStart: (rung: ScenarioRung) => void;
  onContinue: (rung: ScenarioRung) => void;
  onRuns: (rung: ScenarioRung) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const lead = familyLead(family);
  const spec = React.useMemo(() => (lead ? rungSceneSpec(lead) : null), [lead]);
  if (!lead || !spec) return null;
  const accent = spec.accent ?? theme.accent;
  // The first unfinished rung is the card's Start; a resumable one wins.
  const resumable = family.rungs.find(isResumable) ?? null;
  const nextRung = family.rungs.find((r) => r.bestStats === null) ?? family.rungs[0]!;
  const runCount = family.rungs.reduce((n, r) => n + r.runCount, 0);

  return (
    <View className="overflow-hidden rounded-xl border border-border bg-surface">
      <View className="flex-row">
        <View style={{ width: 4, backgroundColor: accent }} />
        <View className="flex-1 gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <HostThumb spec={spec} />
            <View className="flex-1 gap-0.5">
              <RNText className="font-reading text-xl text-text" numberOfLines={1}>
                {lead.titleRu}
              </RNText>
              <Text variant="caption" numberOfLines={1}>
                {lead.titleEn}
                {spec.hostName ? ` · ${spec.hostName}` : ''}
              </Text>
              <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
                {family.rungs.map((rung) => (
                  <RungChip
                    key={rung.id}
                    rung={rung}
                    disabled={disabled}
                    onPress={() => (isResumable(rung) ? onContinue(rung) : onStart(rung))}
                  />
                ))}
              </View>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {resumable ? (
              <Pressable
                onPress={() => onContinue(resumable)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Continue ${resumable.titleRu} ${resumable.level}`}
                className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 ${
                  disabled ? 'opacity-40' : 'active:opacity-80'
                }`}
              >
                <Ionicons name="play" size={15} color={theme.bg} />
                <Text className="font-ui-medium text-bg">Continue · {resumable.level}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onStart(nextRung)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Start ${nextRung.titleRu} ${nextRung.level}`}
                className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 ${
                  disabled ? 'opacity-40' : 'active:opacity-80'
                }`}
              >
                <Ionicons name="mic" size={15} color={theme.bg} />
                <Text className="font-ui-medium text-bg">Начать · {nextRung.level}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => onRuns(nextRung)}
              accessibilityRole="button"
              accessibilityLabel={`Runs of ${lead.titleRu}`}
              className="flex-row items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3.5 py-3 active:bg-surface"
            >
              <Ionicons name="time-outline" size={15} color={theme.textMuted} />
              <Text variant="caption">Runs · {runCount}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function RungChip({
  rung,
  disabled,
  onPress,
}: {
  rung: ScenarioRung;
  disabled: boolean;
  onPress: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const state = rungChipState(rung);
  const resumable = isResumable(rung);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${rung.level} — ${state === 'clean' ? 'clean run' : state === 'finished' ? 'finished' : 'not played'}${resumable ? ', in progress' : ''}`}
      className={`flex-row items-center gap-1 rounded-full border px-1 py-0.5 ${
        resumable ? 'border-accent/50' : 'border-border'
      } ${disabled ? 'opacity-50' : 'active:bg-surface-2'}`}
    >
      <LevelChip level={rung.level} />
      {state === 'clean' && <Ionicons name="star" size={12} color={theme.accent} />}
      {state === 'finished' && <Ionicons name="checkmark-circle" size={13} color={theme.success} />}
      {resumable && <Ionicons name="pause-circle-outline" size={13} color={theme.accent} />}
      <View style={{ width: 2 }} />
    </Pressable>
  );
}
