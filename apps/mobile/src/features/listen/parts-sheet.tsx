import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import type { ListenSegment } from '@/db/repositories/listen';
import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatTime } from './format-time';

interface PartsSheetProps {
  open: boolean;
  segments: readonly ListenSegment[];
  currentIndex: number;
  onSelect(index: number): void;
  onClose(): void;
}

export function PartsSheet({ open, segments, currentIndex, onSelect, onClose }: PartsSheetProps) {
  const { tokens } = useAppTheme();
  if (!open) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View className="max-h-[70%] rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <Text className="font-ui-medium pb-2">Части</Text>
        <ScrollView>
          {segments.map((seg, i) => {
            const selected = i === currentIndex;
            return (
              <Pressable
                key={`${seg.storyId}-${seg.trackId}`}
                onPress={() => {
                  onSelect(i);
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
                <View className="flex-1">
                  <Text numberOfLines={1}>{`${i + 1}. ${seg.titleRu}`}</Text>
                </View>
                <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                  {formatTime(seg.endMs - seg.startMs)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
