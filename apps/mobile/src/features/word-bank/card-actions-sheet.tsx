import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import type { CardRow } from '@/db/repositories/reviews';
import type { CardActionKind } from '@/features/review/card-actions';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Per-direction card menu (T39, item detail «⋯»). A bottom sheet rather than
 * `Alert.alert`: the menu carries up to four actions and Android's alert caps
 * at three buttons. Reset is the one destructive step, so it confirms first.
 */
export function CardActionsSheet({
  open,
  directionLabel,
  card,
  now,
  onAction,
  onClose,
}: {
  open: boolean;
  directionLabel: string;
  card: CardRow;
  now: number;
  onAction: (kind: CardActionKind) => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const buried = card.buriedUntil != null && card.buriedUntil > now;

  const rows: {
    kind: CardActionKind;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
  }[] = [
    buried
      ? { kind: 'unbury', label: 'Unbury', icon: 'sunny-outline' }
      : { kind: 'bury', label: 'Bury until tomorrow', icon: 'moon-outline' },
    card.suspendedAt != null
      ? { kind: 'unsuspend', label: 'Unsuspend', icon: 'play-outline' }
      : { kind: 'suspend', label: 'Suspend', icon: 'pause-outline' },
  ];

  const confirmReset = () => {
    Alert.alert(
      'Reset this card to new?',
      'Its review history is kept; only the schedule starts over.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => onAction('reset') },
      ],
    );
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />
      <View
        className="rounded-t-2xl border-t border-border bg-surface px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">{directionLabel}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        <View className="overflow-hidden rounded-xl border border-border bg-surface-2">
          {rows.map((r, i) => (
            <Pressable
              key={r.kind}
              onPress={() => onAction(r.kind)}
              accessibilityRole="button"
              accessibilityLabel={r.label}
              className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-border ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <Ionicons name={r.icon} size={18} color={tokens.text} />
              <Text className="font-ui-medium">{r.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={confirmReset}
            accessibilityRole="button"
            accessibilityLabel="Reset…"
            className="flex-row items-center gap-3 border-t border-border px-4 py-3.5 active:bg-border"
          >
            <Ionicons name="refresh-outline" size={18} color={tokens.danger} />
            <Text className="font-ui-medium text-danger">Reset…</Text>
          </Pressable>
        </View>

        <Text variant="caption" className="mt-3">
          Suspend stops this direction everywhere, until you unsuspend it. Bury hides it for the
          rest of today.
        </Text>
      </View>
    </Modal>
  );
}
