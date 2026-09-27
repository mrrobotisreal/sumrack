import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ScenarioRunDebrief } from '@/db/repositories/scenarios';
import { useAppTheme } from '@/theme/use-app-theme';

import { attemptFile } from '../recordings/paths';
import {
  attemptBadges,
  formatDuration,
  levelStrip,
  metaLabel,
  type AttemptBadge,
  type DebriefAttempt,
} from './debrief-core';
import type { ClipPlayer } from './use-clip-player';

/**
 * One attempt inside a turn card (T63 §10.2): ▶ (WAV or OGG), the level
 * strip from the duration, `Услышал: …` with the T12 per-word ✓/✗ chips
 * against the target, and the badges. Media states: local file ⇒ playable;
 * pruned + bundle uploaded ⇒ «Recording archived — Download N KB» (one
 * button per run, rendered by the screen — the row just says archived);
 * pruned + no bundle ⇒ «Recording deleted». A meta attempt («что значит
 * …») renders as one quiet line.
 */

const BADGE_LABEL: Record<AttemptBadge, string> = {
  rescued: 'rescued',
  assisted: 'assisted',
  skipped: 'skipped',
  'near miss': 'near miss',
  matched: '✓',
  miss: '✗',
};

export type MediaState = 'local' | 'archived' | 'deleted' | 'downloading';

export function AttemptRow({
  runId,
  attempt,
  step,
  media,
  clips,
  onPlayed,
}: {
  runId: string;
  attempt: DebriefAttempt;
  step: ScenarioRunDebrief['turns'][number]['step'];
  media: MediaState;
  clips: ClipPlayer;
  onPlayed: (ext: 'wav' | 'ogg') => void;
}) {
  const { tokens } = useAppTheme();
  const strip = React.useMemo(
    () => levelStrip(attempt.audioDurationMs, attempt.id),
    [attempt.audioDurationMs, attempt.id],
  );

  if (attempt.kind === 'meta') {
    const q = attempt.detail?.kind === 'meta' ? attempt.detail.query : attempt.transcript;
    const src = attempt.detail?.kind === 'meta' ? attempt.detail.source : 'none';
    return (
      <View className="mt-2 flex-row items-center gap-2 pl-1">
        <Ionicons name="help-circle-outline" size={14} color={tokens.textMuted} />
        <Text variant="caption" className="flex-1" numberOfLines={2}>
          Спросил: {metaLabel(attempt.outcome)}
          {q ? ` «${q}»` : ''}
          {src !== 'none' ? ` → ${src}` : ''}
        </Text>
      </View>
    );
  }

  const detail = attempt.detail?.kind === 'answer' ? attempt.detail : null;
  const badges = attemptBadges(attempt, step);
  const key = attempt.id;
  const file = attempt.audioFile;
  const playable = media === 'local' && !!file;
  const isPlaying = clips.playing === key;
  const good = attempt.outcome === 'matched' || attempt.outcome === 'rescued';

  return (
    <View className="mt-2 rounded-xl border border-border bg-bg p-3">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => {
            if (!playable || !file) return;
            const started = clips.toggle(key, attemptFile(runId, file).uri);
            if (started) onPlayed(file.endsWith('.wav') ? 'wav' : 'ogg');
          }}
          disabled={!playable}
          accessibilityRole="button"
          accessibilityLabel={
            isPlaying ? 'Pause your recording' : playable ? 'Play your recording' : 'No recording'
          }
          className={`h-9 w-9 items-center justify-center rounded-full ${
            playable ? 'bg-accent active:opacity-80' : 'bg-surface-2'
          }`}
        >
          {media === 'downloading' ? (
            <ActivityIndicator size="small" color={tokens.accent} />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : playable ? 'play' : 'mic-off-outline'}
              size={16}
              color={playable ? tokens.bg : tokens.textMuted}
            />
          )}
        </Pressable>
        <View className="flex-1 flex-row items-end gap-[2px]" style={{ height: 22 }}>
          {strip.map((v, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: Math.max(3, Math.round(v * 22)),
                borderRadius: 1,
                backgroundColor: !playable
                  ? tokens.border
                  : isPlaying
                    ? tokens.accent
                    : good
                      ? tokens.success
                      : tokens.textMuted,
                opacity: playable ? 0.9 : 0.6,
              }}
            />
          ))}
        </View>
        <Text variant="caption">{formatDuration(attempt.audioDurationMs)}</Text>
      </View>

      {media !== 'local' && attempt.audioDurationMs != null && attempt.audioDurationMs > 0 && (
        <Text variant="caption" className="mt-1.5">
          {media === 'archived'
            ? 'Recording archived'
            : media === 'downloading'
              ? 'Downloading…'
              : 'Recording deleted'}
        </Text>
      )}

      <View className="mt-2.5 flex-row flex-wrap items-center gap-1.5">
        <Text variant="caption" className="mr-1">
          Услышал:
        </Text>
        {detail && detail.words.length > 0 ? (
          detail.words.map((w, i) => (
            <View
              key={`${i}-${w.target}`}
              className={`rounded-md px-2 py-1 ${w.matched ? 'bg-success/20' : 'bg-danger/25'}`}
            >
              <RNText
                className="font-reading text-base"
                style={{ color: w.matched ? tokens.success : tokens.danger }}
              >
                {w.heard ?? w.display}
              </RNText>
            </View>
          ))
        ) : (
          <RNText className="font-reading text-base text-text-muted">
            {attempt.transcript ? `«${attempt.transcript}»` : '—'}
          </RNText>
        )}
      </View>
      {detail && detail.words.some((w) => !w.matched && w.heard && w.heard !== w.target) && (
        <Text variant="caption" className="mt-1">
          Ожидалось: {detail.words.map((w) => w.display).join(' ')}
        </Text>
      )}

      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
        {badges.map((b) => (
          <View
            key={b}
            className={`rounded-full px-2 py-0.5 ${
              b === 'matched'
                ? 'bg-success/20'
                : b === 'miss'
                  ? 'bg-danger/20'
                  : b === 'near miss'
                    ? 'bg-accent-soft'
                    : 'bg-surface-2'
            }`}
          >
            <Text
              variant="caption"
              className={
                b === 'matched'
                  ? 'text-success'
                  : b === 'miss'
                    ? 'text-danger'
                    : b === 'near miss'
                      ? 'text-accent'
                      : ''
              }
            >
              {BADGE_LABEL[b]}
            </Text>
          </View>
        ))}
        {detail && (
          <Text variant="caption" className="ml-auto">
            {Math.round(detail.score)}%
          </Text>
        )}
      </View>
    </View>
  );
}
