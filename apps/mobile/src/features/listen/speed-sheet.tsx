import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { LISTEN_RATES, type ListenRate } from './prefs';

export function rateLabel(rate: number): string {
  return `${rate}×`;
}

interface SpeedSheetProps {
  open: boolean;
  rate: ListenRate;
  onSelect(rate: ListenRate): void;
  onClose(): void;
}

export function SpeedSheet({ open, rate, onSelect, onClose }: SpeedSheetProps) {
  const { tokens } = useAppTheme();
  if (!open) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <Text className="font-ui-medium pb-2">Скорость</Text>
        {LISTEN_RATES.map((r) => {
          const selected = r === rate;
          return (
            <Pressable
              key={r}
              onPress={() => {
                onSelect(r);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className="flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-surface-2"
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? tokens.accent : tokens.border}
              />
              <Text className="flex-1">{rateLabel(r)}</Text>
              {r === 1 ? <Text variant="caption">Обычная</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
