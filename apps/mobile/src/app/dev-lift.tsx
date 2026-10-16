import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Lift } from '@/features/hotel/lift/lift';
import { useMotionPrefs, useReduceMotion } from '@/store/motion-prefs';

/**
 * T91 lift gallery (`__DEV__` only, the dev-scene pattern). Panel presets for
 * the four acceptance cases, a reduce-motion toggle, and `[lift-lab]` JSON logs
 * so a driver can read what happened.
 *
 * Deep link: `sumrak://dev-lift?preset=start|mid|skip13|reveal13&n=<nonce>`.
 *   start    – 0 unlocked, standing on 0 (▲ dark on the highest unlocked floor).
 *   mid      – unlocked 4, standing on 4 (▲ dark on 4).
 *   skip13   – unlocked 15, standing on 12 (a 12 → 14 ride shows the flicker).
 *   reveal13 – unlocked 15, floor 15 passed, the «13» button shown.
 */

const BASE_PANEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15] as const;
const REVEAL_PANEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

type PresetName = 'start' | 'mid' | 'skip13' | 'reveal13';

interface Preset {
  panel: readonly number[];
  floor: number;
  highestUnlocked: number;
  reveal13: boolean;
}

const PRESETS: Record<PresetName, Preset> = {
  start: { panel: BASE_PANEL, floor: 0, highestUnlocked: 0, reveal13: false },
  mid: { panel: BASE_PANEL, floor: 4, highestUnlocked: 4, reveal13: false },
  skip13: { panel: BASE_PANEL, floor: 12, highestUnlocked: 15, reveal13: false },
  reveal13: { panel: REVEAL_PANEL, floor: 15, highestUnlocked: 15, reveal13: true },
};

function presetFrom(raw: string | undefined): PresetName {
  return raw === 'mid' || raw === 'skip13' || raw === 'reveal13' ? raw : 'start';
}

/** Placeholder floor titles for the gallery (T92 supplies the real ones). */
function titleFor(floor: number): { ru: string; en: string } {
  if (floor === 0) return { ru: 'Вестибюль', en: 'Lobby' };
  if (floor === 13) return { ru: 'Номер 13', en: 'Room 13' };
  return { ru: `Этаж ${floor}`, en: `Floor ${floor}` };
}

function log(event: string, data: Record<string, unknown>): void {
  console.log(`[lift-lab] ${JSON.stringify({ event, ...data })}`);
}

export default function DevLiftScreen() {
  const params = useLocalSearchParams<{ preset?: string; n?: string }>();
  const preset = presetFrom(params.preset);
  const base = PRESETS[preset];
  const reduced = useReduceMotion();

  // The lab is keyed on the preset and nonce, so a new deep link remounts it.
  const labKey = `${preset}-${params.n ?? ''}`;
  if (!__DEV__) return null;
  return <LiftLab key={labKey} preset={preset} base={base} n={params.n} reduced={reduced} />;
}

function LiftLab({
  preset,
  base,
  n,
  reduced,
}: {
  preset: PresetName;
  base: Preset;
  n: string | undefined;
  reduced: boolean;
}) {
  const setReduce = useMotionPrefs((s) => s.setReduceMotion);
  const appReduce = useMotionPrefs((s) => s.reduceMotion);
  const [floor, setFloor] = React.useState(base.floor);
  const [highest, setHighest] = React.useState(base.highestUnlocked);
  const [lastArrive, setLastArrive] = React.useState<number | null>(null);

  React.useEffect(() => {
    log('preset', { preset, n: n ?? null });
  }, [preset, n]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} className="flex-1 bg-bg">
      <View className="gap-1">
        <Text variant="caption">
          preset {preset} · floor {floor} · unlocked {highest} · reduce {String(reduced)}
        </Text>
        <Text variant="caption">last arrive: {lastArrive === null ? '—' : String(lastArrive)}</Text>
      </View>

      <Lift
        panel={base.panel}
        floor={floor}
        highestUnlocked={highest}
        titleFor={titleFor}
        reveal13={base.reveal13}
        onArrive={(f) => {
          setFloor(f);
          setLastArrive(f);
          log('arrive', { floor: f });
        }}
        onBlockedUp={() => log('blocked-up', { floor, highest })}
        onRide13={() => {
          setFloor(13);
          log('ride13-done', {});
        }}
      >
        <View className="flex-1 items-center justify-center p-4">
          <Text variant="caption">floor {floor}</Text>
        </View>
      </Lift>

      <View className="gap-2">
        <Text
          accessibilityRole="button"
          onPress={() => {
            const next = !appReduce;
            setReduce(next);
            log('reduce-motion', { enabled: next });
          }}
          className="font-ui-medium text-accent"
        >
          Reduce motion: {appReduce ? 'on' : 'off'}
        </Text>
        <Text variant="caption">Highest unlocked: {highest} (tap to raise by one)</Text>
        <Text
          accessibilityRole="button"
          onPress={() => {
            setHighest((h) => Math.min(15, h + 1));
            log('unlock', { highest: Math.min(15, highest + 1) });
          }}
          className="font-ui text-text-muted"
        >
          Unlock next floor
        </Text>
      </View>
    </ScrollView>
  );
}
