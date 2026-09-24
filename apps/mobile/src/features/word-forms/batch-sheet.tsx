import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useItemsWithoutLemmaCount, useItemsWithoutProfileCount } from '@/db/hooks';
import { GenerateSheet } from '@/features/ai/generate-sheet';
import type { AiRunProfile } from '@/features/ai/run-profile';
import { useAppTheme } from '@/theme/use-app-theme';

import type { BatchPauseReason } from './batch-core';
import {
  cancelWordFormsBatch,
  dismissWordFormsBatch,
  hydrateWordFormsBatch,
  pumpWordFormsBatch,
  retryWordFormsBatch,
  startBatch,
} from './batch-service';
import { useWordFormsBatch } from './use-word-forms-batch';

const PAUSE_COPY: Record<BatchPauseReason, string> = {
  offline: 'Paused — offline, continues when you reconnect',
  'no-key': 'Paused — no OpenRouter key (Settings → AI)',
  'http-auth': 'Paused — the API key was rejected (Settings → AI)',
  transport: 'Paused — network trouble, continues on the next try',
};

/**
 * The Словарь batch row (WORD_FORMS §7.5), rendered under the chip row:
 *   idle + N > 0  → «{N} words without forms · Generate all» → Generate sheet (purpose 'batch')
 *   running       → «Generating forms · 12/37 · «страшный»…» + Cancel
 *   paused        → the reason + Cancel (the worker resumes by itself)
 *   finished with failures → «3 failed · Retry» (+ dismiss)
 * Durable state lives in `grammar.batch`; this reads the zustand mirror.
 */
export function WordFormsBatchRow() {
  const { tokens: theme } = useAppTheme();
  const progress = useWordFormsBatch();
  const without = useItemsWithoutProfileCount();
  const noLemma = useItemsWithoutLemmaCount();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Read the row once on mount so a batch left behind by a kill shows at once.
  React.useEffect(() => {
    void hydrateWordFormsBatch();
  }, []);

  const n = without.data ?? 0;
  const skipped = noLemma.data ?? 0;
  const active = progress.phase !== 'idle' || progress.remaining > 0;
  const finishedWithFailures =
    progress.phase === 'idle' && progress.remaining === 0 && progress.failed > 0;

  const onGenerate = React.useCallback((run: AiRunProfile) => {
    setSheetOpen(false);
    setBusy(true);
    void startBatch(run).finally(() => setBusy(false));
  }, []);

  const sheet = (
    <GenerateSheet
      open={sheetOpen}
      purpose="batch"
      title={`Generate forms for ${n} ${n === 1 ? 'word' : 'words'}`}
      count={n}
      note={skipped > 0 ? `${skipped} skipped — no lemma yet` : undefined}
      onClose={() => setSheetOpen(false)}
      onGenerate={onGenerate}
    />
  );

  // --- running / paused ------------------------------------------------------
  if (active) {
    const step = Math.min(progress.count, progress.done + progress.failed + 1);
    const line =
      progress.phase === 'running'
        ? `Generating forms · ${step}/${progress.count}${
            progress.currentHeadword ? ` · «${progress.currentHeadword}»…` : '…'
          }`
        : `Generating forms · ${progress.done + progress.failed}/${progress.count}`;
    const sub =
      progress.phase === 'paused' && progress.pauseReason
        ? PAUSE_COPY[progress.pauseReason]
        : progress.failed > 0
          ? `${progress.failed} failed so far`
          : 'One word at a time — safe to leave the app';
    return (
      <View
        className="mx-4 mb-2 flex-row items-center gap-3 rounded-xl border border-accent/40 bg-surface px-4 py-3"
        accessibilityLabel="Word forms batch"
      >
        {progress.phase === 'running' ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Pressable
            onPress={() => void pumpWordFormsBatch()}
            hitSlop={8}
            accessibilityLabel="Resume batch"
          >
            <Ionicons name="pause-circle-outline" size={20} color={theme.textMuted} />
          </Pressable>
        )}
        <View className="flex-1">
          <Text
            className="font-ui-medium text-sm"
            numberOfLines={1}
            accessibilityLabel="Batch progress"
          >
            {line}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Pressable
          onPress={() => void cancelWordFormsBatch()}
          accessibilityRole="button"
          accessibilityLabel="Cancel batch"
          className="rounded-lg border border-border px-3 py-1.5 active:bg-surface-2"
        >
          <Text className="text-sm text-text-muted">Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // --- finished with failures -------------------------------------------------
  if (finishedWithFailures) {
    return (
      <View
        className="mx-4 mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
        accessibilityLabel="Word forms batch"
      >
        <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
        <View className="flex-1">
          <Text className="font-ui-medium text-sm" accessibilityLabel="Batch result">
            {progress.failed} failed · {progress.done} done
          </Text>
          <Text variant="caption" numberOfLines={1}>
            Retry re-runs only the failed words
          </Text>
        </View>
        <Pressable
          onPress={() => void retryWordFormsBatch()}
          accessibilityRole="button"
          accessibilityLabel="Retry failed"
          className="rounded-lg bg-accent px-3 py-1.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-sm">Retry</Text>
        </Pressable>
        <Pressable
          onPress={() => void dismissWordFormsBatch()}
          hitSlop={8}
          accessibilityLabel="Dismiss batch result"
        >
          <Ionicons name="close" size={18} color={theme.textMuted} />
        </Pressable>
      </View>
    );
  }

  // --- idle entry ----------------------------------------------------------------
  if (n === 0 || !progress.hydrated) return null;
  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Generate all forms"
        className="mx-4 mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
      >
        <Ionicons name="grid-outline" size={16} color={theme.accent} />
        <View className="flex-1">
          <Text className="font-ui-medium text-sm">
            {n} {n === 1 ? 'word' : 'words'} without forms · Generate all
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {skipped > 0
              ? `${skipped} skipped — no lemma yet (Edit or Enrich first)`
              : 'Conjugations, declensions, word family — one run each, yours offline'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        )}
      </Pressable>
      {sheet}
    </>
  );
}
