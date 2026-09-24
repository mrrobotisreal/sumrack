import Slider from '@react-native-community/slider';
import * as React from 'react';
import { Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAmbientPrefs } from '@/store/ambient-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { SoundtracksList } from './soundtracks-list';

export function AmbientSettingsSection() {
  const { enabled, volume, playDuringNarration, setPrefs } = useAmbientPrefs();
  const { tokens } = useAppTheme();
  const [draftPercent, setDraftPercent] = React.useState<number | null>(null);
  const sliding = React.useRef(false);
  const volumePercent = draftPercent ?? Math.round(volume * 100);

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
              A soundtrack matched to what you&apos;re reading — creepy for stories, a newsroom bed
              for news, upbeat for comedy, driving for action, focus music for study.
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
          <>
            <View className="border-t border-border px-4 py-3.5">
              <View className="mb-2 flex-row items-center justify-between gap-3">
                <Text className="font-ui-medium">Music volume</Text>
                <Text variant="muted">{volumePercent}%</Text>
              </View>
              <Slider
                style={{ width: '100%', height: 48 }}
                minimumValue={0}
                maximumValue={100}
                step={1}
                value={Math.round(volume * 100)}
                onSlidingStart={() => {
                  sliding.current = true;
                }}
                onValueChange={(percent) => {
                  if (sliding.current) setDraftPercent(percent);
                  // Keyboard/TalkBack adjustments do not emit touch completion.
                  else setPrefs({ volume: percent / 100 });
                }}
                onSlidingComplete={(percent) => {
                  sliding.current = false;
                  setDraftPercent(null);
                  setPrefs({ volume: percent / 100 });
                }}
                minimumTrackTintColor={tokens.accent}
                maximumTrackTintColor={tokens.textMuted}
                thumbTintColor={tokens.text}
                accessibilityLabel="Background music volume"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: volumePercent,
                  text: `${volumePercent}%`,
                }}
              />
              <View className="flex-row justify-between">
                <Text variant="caption">0%</Text>
                <Text variant="caption">100%</Text>
              </View>
            </View>
            <View className="flex-row items-center justify-between border-t border-border px-4 py-3.5">
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">Play during narration</Text>
                <Text variant="caption">
                  When off, music pauses while the story is read aloud and resumes when narration
                  pauses or ends.
                </Text>
              </View>
              <Switch
                value={playDuringNarration}
                onValueChange={(value) => setPrefs({ playDuringNarration: value })}
                trackColor={{ false: tokens.surface2, true: tokens.accent }}
                thumbColor={tokens.text}
                accessibilityLabel="Play background music during narration"
              />
            </View>
            <SoundtracksList />
          </>
        )}
      </View>
    </>
  );
}
