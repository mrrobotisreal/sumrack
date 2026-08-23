import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { LevelChip } from '@/components/level-chip';
import type { StoredAssessment } from '@/features/ai/schemas';
import { ASSESSMENT_SKILLS } from '@/features/ai/schemas';
import { useAppTheme } from '@/theme/use-app-theme';

import { SectionCard } from './section-card';

const SKILL_LABELS: Record<(typeof ASSESSMENT_SKILLS)[number], string> = {
  reading: 'Reading',
  listening: 'Listening',
  writing: 'Writing',
  speaking: 'Speaking*',
};

/**
 * The dashboard's AI-assessment summary card (online-only sub-feature,
 * design §7.6): latest per-skill estimate + when, tap → detail/trend.
 * Offline or key-less states stay visible but clearly non-blocking.
 */
export function AssessmentCard({
  latest,
  online,
  autoRunning,
}: {
  latest: StoredAssessment | null;
  online: boolean;
  /** An automatic weekly assessment is in flight right now. */
  autoRunning: boolean;
}) {
  const router = useRouter();
  const { tokens } = useAppTheme();

  return (
    <SectionCard title="AI assessment">
      <Pressable
        onPress={() => router.push('/dashboard/assessment')}
        accessibilityRole="button"
        accessibilityLabel="Open AI assessment"
        className="active:opacity-80"
      >
        {latest ? (
          <>
            <View className="flex-row flex-wrap gap-x-4 gap-y-2">
              {ASSESSMENT_SKILLS.map((skill) => (
                <View key={skill} className="flex-row items-center gap-1.5">
                  <LevelChip level={latest.skills[skill].level} />
                  <Text variant="caption">{SKILL_LABELS[skill]}</Text>
                </View>
              ))}
            </View>
            <Text variant="caption" className="mt-2.5">
              *speaking is a pronunciation-based proxy · updated{' '}
              {new Date(latest.createdAt).toLocaleDateString()}
            </Text>
          </>
        ) : (
          <Text variant="muted">
            No assessment yet — Claude estimates your CEFR level per skill from your journal and
            stats.
          </Text>
        )}

        <View className="mt-3 flex-row items-center gap-2">
          {autoRunning ? (
            <>
              <ActivityIndicator size="small" color={tokens.accent} />
              <Text variant="caption">Weekly assessment running…</Text>
            </>
          ) : !online ? (
            <>
              <Ionicons name="cloud-offline-outline" size={14} color={tokens.textMuted} />
              <Text variant="caption">Offline — assessment needs a connection</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={14} color={tokens.accent} />
              <Text variant="caption" className="text-accent">
                {latest ? 'View details & trend' : 'Run first assessment'}
              </Text>
            </>
          )}
          <View className="flex-1" />
          <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
        </View>
      </Pressable>
    </SectionCard>
  );
}
