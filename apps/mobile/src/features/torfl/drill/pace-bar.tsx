import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

import { paceFraction } from '../pace';

/**
 * «Молния»'s per-item pace bar (T70, §7.3): fills over `paceSec` seconds and
 * turns danger-coloured past 100 %. VISUAL ONLY — it never auto-skips. It
 * restarts when `resetKey` changes and freezes while `running` is false.
 */
export function PaceBar({
  paceSec,
  resetKey,
  running,
}: {
  paceSec: number;
  resetKey: string | number;
  running: boolean;
}) {
  const [tick, setTick] = React.useState<{ key: string | number; elapsed: number }>({
    key: resetKey,
    elapsed: 0,
  });
  // The clock starts when `resetKey` changes (a new item) and ticks while running.
  React.useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => setTick({ key: resetKey, elapsed: Date.now() - start }), 200);
    return () => clearInterval(id);
  }, [running, resetKey]);

  const elapsed = tick.key === resetKey ? tick.elapsed : 0;
  const fraction = paceFraction(elapsed, paceSec);
  const over = fraction > 1;
  return (
    <View className="gap-1 px-4" testID="pace-bar">
      <View className="h-2 overflow-hidden rounded-full bg-surface-2">
        <View
          className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${Math.min(1, fraction) * 100}%` }}
        />
      </View>
      <Text variant="caption" className="text-right text-xs">
        {Math.round(elapsed / 1000)} с · темп экзамена {paceSec} с
      </Text>
    </View>
  );
}
