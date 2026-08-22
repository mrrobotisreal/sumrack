import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { FeedbackBadge } from '@/features/journal/feedback-badge';
import type { JournalEntryRow } from '@/db/repositories/journal';
import { useAppTheme } from '@/theme/use-app-theme';

import { FeedbackView } from './feedback-view';
import { cancelFeedback, pumpFeedbackQueue, requestFeedback, useAiQueue } from './journal-feedback';
import { parseStoredFeedback } from './schemas';

/**
 * The journal editor's AI-feedback surface (replaces T15's inert card):
 * request button → queued/sending/error states (every stage user-visible,
 * ticket item 2) → rendered FeedbackView on 'done'. Requesting while
 * offline is a first-class path: the row queues and the worker submits on
 * reconnect — the button never requires connectivity to work.
 */
export function FeedbackSection({ entry }: { entry: JournalEntryRow }) {
  const { tokens: theme } = useAppTheme();
  const ephemeral = useAiQueue((s) => s.byEntry[entry.id]);
  const [busy, setBusy] = React.useState(false);

  const status = entry.feedbackStatus;
  const feedback = React.useMemo(() => parseStoredFeedback(entry.aiFeedback), [entry.aiFeedback]);

  const request = React.useCallback(() => {
    setBusy(true);
    void requestFeedback(entry.id).finally(() => setBusy(false));
  }, [entry.id]);

  const cancel = React.useCallback(() => {
    setBusy(true);
    void cancelFeedback(entry.id).finally(() => setBusy(false));
  }, [entry.id]);

  if (status === 'queued') {
    const phase = ephemeral?.phase ?? 'queued';
    return (
      <View className="mt-8 rounded-2xl border border-border bg-surface px-4 py-3.5">
        <View className="flex-row items-center gap-3">
          {phase === 'sending' ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Ionicons
              name={phase === 'error' ? 'alert-circle-outline' : 'time-outline'}
              size={20}
              color={phase === 'error' ? theme.danger : theme.accent}
            />
          )}
          <View className="flex-1">
            <Text className="font-ui-medium text-sm">
              {phase === 'sending'
                ? 'Getting feedback…'
                : phase === 'error'
                  ? 'Feedback failed'
                  : 'Feedback queued'}
            </Text>
            <Text variant="caption">
              {phase === 'error'
                ? (ephemeral?.message ?? 'Something went wrong. Tap retry.')
                : phase === 'sending'
                  ? 'Your tutor is reading the entry.'
                  : 'Sends automatically when you’re online.'}
            </Text>
          </View>
          <FeedbackBadge status="queued" />
        </View>
        <View className="mt-3 flex-row gap-2">
          {phase !== 'sending' && (
            <Pressable
              onPress={() => void pumpFeedbackQueue()}
              accessibilityRole="button"
              className="flex-1 items-center rounded-xl bg-accent px-4 py-2 active:opacity-80"
            >
              <Text className="font-ui-medium text-sm">
                {phase === 'error' ? 'Retry now' : 'Try now'}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={cancel}
            disabled={busy}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl border border-border px-4 py-2 active:bg-surface-2"
          >
            <Text className="font-ui-medium text-sm text-text-muted">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === 'done' && feedback) {
    return (
      <View className="mt-8 gap-4">
        <FeedbackView feedback={feedback} />
        <Pressable
          onPress={request}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 active:bg-surface-2"
        >
          <Ionicons name="sparkles-outline" size={15} color={theme.textMuted} />
          <Text className="font-ui-medium text-sm text-text-muted">Request fresh feedback</Text>
        </Pressable>
      </View>
    );
  }

  // status 'none' — or 'done' with an unreadable payload (re-request).
  return (
    <Pressable
      onPress={request}
      disabled={busy}
      accessibilityRole="button"
      className="mt-8 flex-row items-center gap-3 rounded-2xl border border-accent/40 bg-surface px-4 py-3.5 active:bg-surface-2"
    >
      <Ionicons name="sparkles-outline" size={18} color={theme.accent} />
      <View className="flex-1">
        <Text className="font-ui-medium text-sm">Get AI feedback</Text>
        <Text variant="caption">
          {status === 'done'
            ? 'Saved feedback couldn’t be read — request again.'
            : 'Corrections and explanations from your tutor. Queues if you’re offline.'}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={theme.accent} />
      ) : (
        <FeedbackBadge status={status === 'done' ? 'done' : 'none'} />
      )}
    </Pressable>
  );
}
