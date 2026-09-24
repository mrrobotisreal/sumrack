import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { BankItemRow } from '@/db/repositories/bank';
import type { WordProfileRecord } from '@/db/repositories/word-forms';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatReceiptLine } from './format';

/**
 * Versions sheet (WORD_FORMS §7.2): every stored profile version for the
 * word's key, newest first, each as a receipt line; the current one is
 * marked; tapping an older one offers «Make current» (`promoteProfile`).
 * There is no delete — versions are kept forever (ADR-0018 decision 10).
 */
export function VersionsSheet({
  open,
  item,
  versions,
  onClose,
  onPromoted,
}: {
  open: boolean;
  item: BankItemRow;
  versions: WordProfileRecord[];
  onClose: () => void;
  onPromoted: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const promote = React.useCallback(
    (id: string) => {
      if (busy) return;
      setBusy(true);
      void repos.wordForms
        .promoteProfile(id)
        .then((ok) => {
          if (ok) {
            track('word_profile_version_promoted', { kind: item.kind });
            onPromoted();
          }
          setSelected(null);
        })
        .finally(() => setBusy(false));
    },
    [busy, item.kind, onPromoted],
  );

  const close = React.useCallback(() => {
    setSelected(null);
    onClose();
  }, [onClose]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 bg-scrim/50" onPress={close} accessibilityLabel="Close" />

      <View
        className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4"
        style={{ maxHeight: '70%' }}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Versions · {versions.length}</Text>
          <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close versions sheet">
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator>
          <View className="overflow-hidden rounded-xl border border-border">
            {versions.map((v, i) => {
              const isSelected = selected === v.id;
              return (
                <View key={v.id} className={i > 0 ? 'border-t border-border' : ''}>
                  <Pressable
                    onPress={() =>
                      v.isCurrent ? undefined : setSelected(isSelected ? null : v.id)
                    }
                    disabled={v.isCurrent}
                    accessibilityRole="button"
                    accessibilityLabel={`Version ${versions.length - i}${v.isCurrent ? ', current' : ''}`}
                    accessibilityState={{ selected: v.isCurrent }}
                    className={`flex-row items-center gap-3 px-4 py-3 ${
                      v.isCurrent ? 'bg-accent-soft' : 'active:bg-surface-2'
                    }`}
                  >
                    <Ionicons
                      name={v.isCurrent ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={v.isCurrent ? theme.accent : theme.textMuted}
                    />
                    <View className="flex-1">
                      <Text className="text-sm">{formatReceiptLine(v)}</Text>
                      <Text variant="caption" className="mt-0.5 text-xs">
                        {v.isCurrent ? 'Current' : `Version ${versions.length - i}`}
                        {v.profile ? '' : ' · unreadable payload'}
                      </Text>
                    </View>
                  </Pressable>
                  {isSelected && !v.isCurrent && (
                    <View className="flex-row justify-end border-t border-border bg-surface-2/60 px-4 py-2">
                      <Pressable
                        onPress={() => promote(v.id)}
                        disabled={busy || !v.profile}
                        accessibilityRole="button"
                        accessibilityLabel="Make current"
                        accessibilityState={{ disabled: busy || !v.profile }}
                        className={`rounded-xl px-4 py-2 ${
                          busy || !v.profile ? 'bg-surface-2' : 'bg-accent active:opacity-80'
                        }`}
                      >
                        <Text
                          className={`font-ui-medium text-sm ${
                            busy || !v.profile ? 'text-text-muted' : 'text-text'
                          }`}
                        >
                          Make current
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
