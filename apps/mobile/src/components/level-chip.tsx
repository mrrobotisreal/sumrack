import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

// One hue ramp, A1 coolest → C1 ember (UI_DESIGN §1 — never rainbow).
// Chips are a tinted wash + colored text, not solid fills, to stay restrained.
const LEVEL_CLASSES: Record<CefrLevel, { bg: string; text: string }> = {
  A1: { bg: 'bg-level-a1/15', text: 'text-level-a1' },
  A2: { bg: 'bg-level-a2/15', text: 'text-level-a2' },
  B1: { bg: 'bg-level-b1/15', text: 'text-level-b1' },
  B2: { bg: 'bg-level-b2/15', text: 'text-level-b2' },
  C1: { bg: 'bg-level-c1/15', text: 'text-level-c1' },
};

/** CEFR level chip (UI_DESIGN §7 component inventory) — Library, word bank, dashboard. */
export function LevelChip({ level, className }: { level: CefrLevel; className?: string }) {
  const classes = LEVEL_CLASSES[level];
  return (
    <View className={cn('rounded-full px-2 py-0.5', classes.bg, className)}>
      <Text className={cn('font-ui-medium text-xs', classes.text)}>{level}</Text>
    </View>
  );
}
