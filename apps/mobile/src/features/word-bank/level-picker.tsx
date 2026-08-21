import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { CefrLevel } from '@/components/level-chip';

export type CefrLevelOrNull = CefrLevel | null;

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** CEFR level selector for bank forms — tap the active one again to clear. */
export function LevelPicker({
  value,
  onChange,
}: {
  value: CefrLevelOrNull;
  onChange: (level: CefrLevelOrNull) => void;
}) {
  return (
    <View className="mb-3 flex-row gap-2">
      {LEVELS.map((l) => {
        const active = value === l;
        return (
          <Pressable
            key={l}
            onPress={() => onChange(active ? null : l)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center rounded-lg border py-2 ${
              active
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-surface-2 active:bg-border'
            }`}
          >
            <Text
              className={`text-sm ${active ? 'font-ui-medium text-accent' : 'text-text-muted'}`}
            >
              {l}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
