import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { LevelChip } from '@/components/level-chip';
import { repos } from '@/db';
import { friendlyAiMessage } from '@/features/ai/errors';
import { isOnline } from '@/features/ai/connectivity';
import { ASSESSMENT_SKILLS, type StoredAssessment } from '@/features/ai/schemas';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { runAssessment } from './assessment';
import { LevelDotTrack, type TrackPoint } from './charts';
import { dashboardKeys, useStoredAssessments } from './hooks';
import { EmptyHint, SectionCard } from './section-card';

const SKILL_LABELS: Record<(typeof ASSESSMENT_SKILLS)[number], string> = {
  reading: 'Reading',
  listening: 'Listening',
  writing: 'Writing',
  speaking: 'Speaking (proxy)',
};

const LEVEL_ORD: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 };

/**
 * AI assessment detail (T18, design §7.6 + UI_DESIGN §3 "assessment
 * detail"): the latest per-skill estimate with evidence notes, focus
 * recommendations, the historical trend per skill, and the manual
 * "Reassess now" action. Online-only; offline shows a clear non-blocking
 * unavailable state.
 */
export function AssessmentScreen() {
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const assessments = useStoredAssessments();

  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    track('assessment_screen_opened');
    void isOnline().then(setOnline);
  }, []);

  const reassess = React.useCallback(() => {
    setError(null);
    setRunning(true);
    void (async () => {
      try {
        await runAssessment(repos, 'manual');
        await queryClient.invalidateQueries({ queryKey: dashboardKeys.assessments });
      } catch (err) {
        setError(friendlyAiMessage(err));
      } finally {
        setRunning(false);
        void isOnline().then(setOnline);
      }
    })();
  }, [queryClient]);

  if (assessments.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  const history = assessments.data ?? [];
  const latest = history[history.length - 1] ?? null;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
      {latest ? (
        <>
          <SectionCard
            title={`Current estimate · ${new Date(latest.createdAt).toLocaleDateString()}`}
          >
            <View className="gap-3.5">
              {ASSESSMENT_SKILLS.map((skill) => (
                <View key={skill} className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <LevelChip level={latest.skills[skill].level} />
                    <Text className="font-ui-medium">{SKILL_LABELS[skill]}</Text>
                  </View>
                  <Text variant="caption">{latest.skills[skill].note}</Text>
                </View>
              ))}
            </View>
            <Text variant="caption" className="mt-3">
              Speaking is estimated from pronunciation-practice scores only — not a conversational
              assessment.
            </Text>
          </SectionCard>

          <SectionCard title="Focus recommendations">
            <View className="gap-2">
              {latest.recommendations.map((rec, i) => (
                <View key={i} className="flex-row gap-2">
                  <Text className="font-ui-bold text-accent">{i + 1}.</Text>
                  <Text className="flex-1 text-sm">{rec}</Text>
                </View>
              ))}
            </View>
            <Text variant="muted" className="mt-3 text-sm">
              {latest.summary}
            </Text>
          </SectionCard>

          {history.length >= 2 ? (
            <SectionCard title="Trend">
              <View className="gap-4">
                {ASSESSMENT_SKILLS.map((skill) => (
                  <View key={skill} className="gap-1">
                    <Text variant="caption">{SKILL_LABELS[skill]}</Text>
                    <LevelDotTrack points={trendPoints(history, skill)} />
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : (
            <SectionCard title="Trend">
              <EmptyHint>
                One assessment so far — the per-skill trend appears from the second one on.
              </EmptyHint>
            </SectionCard>
          )}
        </>
      ) : (
        <SectionCard title="AI CEFR assessment">
          <Text variant="muted">
            Claude reads your recent journal entries and aggregate study stats, then estimates your
            CEFR level per skill (reading · listening · writing · speaking-proxy) with focus
            recommendations. Runs weekly when online, or on demand below.
          </Text>
        </SectionCard>
      )}

      {/* action row: online-gated, errors inline, never blocks the rest */}
      <View className="gap-2">
        {error && (
          <View className="flex-row items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3">
            <Ionicons name="alert-circle-outline" size={16} color={tokens.danger} />
            <Text className="flex-1 text-sm">{error}</Text>
          </View>
        )}
        {online === false && !running && (
          <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface p-3">
            <Ionicons name="cloud-offline-outline" size={16} color={tokens.textMuted} />
            <Text variant="muted" className="flex-1 text-sm">
              You&apos;re offline. The assessment needs a connection — everything else on the
              dashboard works without one.
            </Text>
          </View>
        )}
        <Pressable
          onPress={reassess}
          disabled={running || online === false}
          accessibilityRole="button"
          accessibilityLabel="Reassess now"
          className={`flex-row items-center justify-center gap-2 rounded-xl py-3.5 ${
            running || online === false ? 'bg-surface-2' : 'bg-accent active:opacity-80'
          }`}
        >
          {running ? (
            <>
              <ActivityIndicator size="small" color={tokens.textMuted} />
              <Text className="font-ui-medium text-text-muted">Assessing…</Text>
            </>
          ) : (
            <>
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={online === false ? tokens.textMuted : tokens.bg}
              />
              <Text
                className={`font-ui-medium ${online === false ? 'text-text-muted' : 'text-bg'}`}
              >
                {latest ? 'Reassess now' : 'Run first assessment'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function trendPoints(
  history: StoredAssessment[],
  skill: (typeof ASSESSMENT_SKILLS)[number],
): TrackPoint[] {
  // Cap at the last 8 assessments so dots keep breathing room on a phone.
  const recent = history.slice(-8);
  return recent.map((a, i) => ({
    ord: LEVEL_ORD[a.skills[skill].level] ?? 1,
    label:
      i === 0 || i === recent.length - 1
        ? new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : undefined,
    emphasized: i === recent.length - 1,
  }));
}
