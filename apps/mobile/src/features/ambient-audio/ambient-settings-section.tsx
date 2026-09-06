import { Pressable, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAmbientPrefs } from '@/store/ambient-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { SOFT_AMBIENT_VOLUME } from './preferences';

const VOLUMES = [
  { label: 'Very quiet', value: 0.04 },
  { label: 'Quiet', value: 0.08 },
  { label: 'Soft', value: SOFT_AMBIENT_VOLUME },
];

export function AmbientSettingsSection() {
  const { enabled, volume, setPrefs } = useAmbientPrefs();
  const { tokens } = useAppTheme();
  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Background music
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Study ambience</Text>
            <Text variant="caption">
              Music while reading and playing, including story narration. Pauses for word readouts,
              listening and pronunciation exercises, and when you leave the app.
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(value) => setPrefs({ enabled: value })}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Background music while studying"
          />
        </View>
        {enabled && (
          <View className="border-t border-border px-4 py-3.5">
            <Text className="mb-2 font-ui-medium">Music level</Text>
            <View className="flex-row flex-wrap gap-2">
              {VOLUMES.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setPrefs({ volume: option.value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: volume === option.value }}
                  accessibilityLabel={`${option.label} background music`}
                  className={`min-h-12 justify-center rounded-full border px-4 py-2 active:bg-surface-2 ${volume === option.value ? 'border-accent bg-surface-2' : 'border-border'}`}
                >
                  <Text className={volume === option.value ? 'text-accent' : 'text-text'}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>
    </>
  );
}
