import Slider from '@react-native-community/slider';
import * as React from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  ENDPOINT_SENSITIVITIES,
  useScenarioPrefs,
  type EndpointSensitivityPref,
} from './store/scenario-prefs';

const SENSITIVITY_LABEL: Record<EndpointSensitivityPref, { label: string; hint: string }> = {
  quick: { label: 'Quick', hint: '0.8 s of silence ends your turn' },
  normal: { label: 'Normal', hint: '1.1 s — the default' },
  patient: { label: 'Patient', hint: '1.6 s — room to think mid-sentence' },
};

/**
 * Settings → Games → «Scenarios» (T62, SPEAKING_SCENARIOS §4.4 / §9): the
 * five run prefs — subtitles (training wheels), hold-to-talk as the primary
 * gesture, online rescue, endpoint sensitivity, scene-bed volume. The
 * ambient section's row pattern; every value flows through the Zod store.
 */
export function ScenarioSettingsSection() {
  const { tokens } = useAppTheme();
  const prefs = useScenarioPrefs((s) => s.prefs);
  const setPrefs = useScenarioPrefs((s) => s.setPrefs);
  const [draftPercent, setDraftPercent] = React.useState<number | null>(null);
  const sliding = React.useRef(false);
  const volumePercent = draftPercent ?? Math.round(prefs.bedVolume * 100);

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Scenarios
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <SwitchRow
          title="Subtitles (training wheels)"
          hint="Show the host's lines as text while they speak. Off by default — the game is blind. Your own words are never shown."
          value={prefs.subtitles}
          onChange={(v) => setPrefs({ subtitles: v })}
          accessibilityLabel="Scenario subtitles"
          first
        />
        <SwitchRow
          title="Hold to talk"
          hint="Make press-and-hold the primary mic gesture (for noisy rooms). Tap-to-talk with silence detection stays available."
          value={prefs.holdToTalk}
          onChange={(v) => setPrefs({ holdToTalk: v })}
          accessibilityLabel="Hold to talk as the primary gesture"
        />
        <SwitchRow
          title="Online rescue"
          hint="When online, a fast model may accept an off-script answer the offline judge missed (≤ 4 s, never blocks). Offline is the same game, slightly stricter."
          value={prefs.rescueOnline}
          onChange={(v) => setPrefs({ rescueOnline: v })}
          accessibilityLabel="Online rescue of missed answers"
        />

        <View className="border-t border-border px-4 py-3.5">
          <Text className="font-ui-medium">End of turn</Text>
          <Text variant="caption" className="mt-0.5">
            How long a pause ends what you&apos;re saying (tap-to-talk only).
          </Text>
          <View className="mt-3 flex-row gap-2">
            {ENDPOINT_SENSITIVITIES.map((s) => {
              const selected = prefs.endpointSensitivity === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setPrefs({ endpointSensitivity: s })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`End of turn: ${SENSITIVITY_LABEL[s].label}`}
                  className={`flex-1 items-center rounded-lg border px-2 py-2 ${
                    selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2'
                  }`}
                >
                  <Text className={`font-ui-medium text-sm ${selected ? 'text-accent' : ''}`}>
                    {SENSITIVITY_LABEL[s].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text variant="caption" className="mt-2">
            {SENSITIVITY_LABEL[prefs.endpointSensitivity].hint}
          </Text>
        </View>

        <View className="border-t border-border px-4 py-3.5">
          <View className="mb-2 flex-row items-center justify-between gap-3">
            <Text className="font-ui-medium">Scene sound</Text>
            <Text variant="muted">{volumePercent}%</Text>
          </View>
          <Slider
            style={{ width: '100%', height: 48 }}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={Math.round(prefs.bedVolume * 100)}
            onSlidingStart={() => {
              sliding.current = true;
            }}
            onValueChange={(percent) => {
              if (sliding.current) setDraftPercent(percent);
              else setPrefs({ bedVolume: percent / 100 });
            }}
            onSlidingComplete={(percent) => {
              sliding.current = false;
              setDraftPercent(null);
              setPrefs({ bedVolume: percent / 100 });
            }}
            minimumTrackTintColor={tokens.accent}
            maximumTrackTintColor={tokens.textMuted}
            thumbTintColor={tokens.text}
            accessibilityLabel="Scene room-tone volume"
            accessibilityValue={{ min: 0, max: 100, now: volumePercent, text: `${volumePercent}%` }}
          />
          <Text variant="caption">
            The room tone under a scenario (ducked while anyone speaks). 0% = silence.
          </Text>
        </View>
      </View>
    </>
  );
}

function SwitchRow({
  title,
  hint,
  value,
  onChange,
  accessibilityLabel,
  first = false,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  accessibilityLabel: string;
  first?: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View
      className={`flex-row items-center justify-between px-4 py-3.5 ${first ? '' : 'border-t border-border'}`}
    >
      <View className="flex-1 gap-0.5 pr-3">
        <Text className="font-ui-medium">{title}</Text>
        <Text variant="caption">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: tokens.surface2, true: tokens.accent }}
        thumbColor={tokens.text}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}
