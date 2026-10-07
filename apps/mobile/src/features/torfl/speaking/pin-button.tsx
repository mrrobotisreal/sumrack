import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable } from 'react-native';

import { repos } from '@/db';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Pin / unpin an exam attempt (T74, TORFL §8.5) — the scenario debrief's pin
 * for exam attempts: a pinned attempt's recordings are never pruned. Shown
 * on the results screen and the speaking debrief. Fires
 * `exam_attempt_pinned {pinned}` and tells the parent to refetch.
 */
export function PinButton({
  attemptId,
  pinned,
  onChanged,
}: {
  attemptId: string;
  pinned: boolean;
  onChanged: () => void;
}) {
  const { tokens } = useAppTheme();
  const [busy, setBusy] = React.useState(false);
  const toggle = React.useCallback(() => {
    if (busy) return;
    setBusy(true);
    const next = !pinned;
    void repos.exams
      .setPinned(attemptId, next)
      .then(() => {
        track('exam_attempt_pinned', { pinned: next });
        onChanged();
      })
      .catch((err) => logError('manual', err))
      .finally(() => setBusy(false));
  }, [attemptId, busy, onChanged, pinned]);
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={pinned ? 'Открепить попытку' : 'Закрепить попытку (записи не удаляются)'}
      accessibilityState={{ selected: pinned }}
      testID="exam-pin"
      className="h-9 w-9 items-center justify-center rounded-full bg-surface-2 active:bg-border"
    >
      <Ionicons
        name={pinned ? 'pin' : 'pin-outline'}
        size={18}
        color={pinned ? tokens.accent : tokens.textMuted}
      />
    </Pressable>
  );
}
