import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { BankSort, BankSortKey, FamiliaritySort } from '@/db/repositories/bank';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

/** Sheet rows in display order (WORD_FORMS §3.3) — label + one-line hint. */
export const BANK_SORT_OPTIONS: { key: BankSortKey; label: string; hint: string }[] = [
  { key: 'added-asc', label: 'Order added', hint: 'The order you met them' },
  { key: 'added-desc', label: 'Newest first', hint: 'Most recently added on top' },
  { key: 'alpha-asc', label: 'А → Я', hint: 'Dictionary order — ё with е' },
  { key: 'alpha-desc', label: 'Я → А', hint: 'Dictionary order, reversed' },
  {
    key: 'unpracticed-first',
    label: 'Unpracticed first',
    hint: 'Never flipped as a flashcard first',
  },
  { key: 'practiced-first', label: 'Practiced first', hint: 'Flashcard-graded words first' },
];

const FAMILIARITY_OPTIONS: { value: FamiliaritySort; label: string }[] = [
  { value: 'least', label: 'Least familiar first' },
  { value: 'most', label: 'Most familiar first' },
];

/** Short caption for the active sort («Practiced first · least familiar»). */
export function describeBankSort(sort: BankSort): string {
  const label = BANK_SORT_OPTIONS.find((o) => o.key === sort.key)?.label ?? sort.key;
  if (sort.key !== 'practiced-first') return label;
  return `${label} · ${sort.familiarity === 'most' ? 'most' : 'least'} familiar`;
}

/** True when the list order depends on flashcard familiarity (row chip shown). */
export function isFamiliaritySort(sort: BankSort): boolean {
  return sort.key === 'unpracticed-first' || sort.key === 'practiced-first';
}

/**
 * Словарь sort sheet (T50, WORD_FORMS §3.3): bottom-anchored Modal (the
 * type-settings-sheet pattern), one radio row per key with its hint, and —
 * only under «Practiced first» — an indented Least/Most familiar segmented
 * control. Every tap applies immediately; the sheet stays open until dismissed.
 */
export function SortSheet({
  open,
  sort,
  onChange,
  onClose,
}: {
  open: boolean;
  sort: BankSort;
  onChange: (patch: Partial<BankSort>) => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Sort</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close sort options">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        {BANK_SORT_OPTIONS.map((opt) => {
          const selected = sort.key === opt.key;
          return (
            <View key={opt.key}>
              <Pressable
                onPress={() => onChange({ key: opt.key })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Sort: ${opt.label}`}
                className="flex-row items-center gap-3 py-2.5 active:opacity-80"
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? tokens.accent : tokens.textMuted}
                />
                <View className="flex-1">
                  <Text className={cn('text-base', selected && 'font-ui-medium text-accent')}>
                    {opt.label}
                  </Text>
                  <Text variant="caption">{opt.hint}</Text>
                </View>
              </Pressable>

              {opt.key === 'practiced-first' && selected && (
                <View className="mb-1 ml-8 gap-1.5">
                  <View className="flex-row overflow-hidden self-start rounded-lg border border-border">
                    {FAMILIARITY_OPTIONS.map((f, i) => {
                      const on = sort.familiarity === f.value;
                      return (
                        <Pressable
                          key={f.value}
                          onPress={() => onChange({ familiarity: f.value })}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={f.label}
                          className={cn(
                            'px-3 py-2',
                            on ? 'bg-accent-soft' : 'bg-surface-2 active:bg-border',
                            i > 0 && 'border-l border-border',
                          )}
                        >
                          <Text
                            className={cn(
                              'text-sm',
                              on ? 'font-ui-medium text-accent' : 'text-text',
                            )}
                          >
                            {f.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text variant="caption">From your Again/Hard vs Good/Easy presses (last 10)</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Modal>
  );
}
