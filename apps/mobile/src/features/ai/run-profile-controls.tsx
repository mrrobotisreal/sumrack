import Slider from '@react-native-community/slider';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  EFFORT_HINT,
  EFFORT_LABELS,
  EFFORT_ORDER,
  MODEL_HINTS,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  QUALITY_LABELS,
  QUALITY_ORDER,
  type AiEffort,
  type AiQuality,
  type AiRunProfile,
  type ModelTable,
} from './run-profile';

/**
 * The shared Provider / Quality / Effort controls (WORD_FORMS §4.5): a
 * radio pair and two 4-notch sliders with their labels, the model hint for
 * the selected quality, and the resolved slug in a caption. Used by the
 * Settings preset section and the Generate sheet — every change goes
 * straight to `onChange` (persisting is the caller's job).
 */
export function RunProfileControls({
  profile,
  table,
  onChange,
}: {
  profile: AiRunProfile;
  table: ModelTable;
  onChange: (next: AiRunProfile) => void;
}) {
  const { tokens } = useAppTheme();
  const qualityIndex = Math.max(0, QUALITY_ORDER.indexOf(profile.quality));
  const effortIndex = Math.max(0, EFFORT_ORDER.indexOf(profile.effort));
  const slug = table[profile.provider][profile.quality];

  return (
    <View className="gap-3">
      <View className="flex-row overflow-hidden self-start rounded-lg border border-border">
        {PROVIDER_ORDER.map((provider, i) => {
          const on = profile.provider === provider;
          return (
            <Pressable
              key={provider}
              onPress={() => onChange({ ...profile, provider })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Provider: ${PROVIDER_LABELS[provider]}`}
              className={cn(
                'px-4 py-2',
                on ? 'bg-accent-soft' : 'bg-surface-2 active:bg-border',
                i > 0 && 'border-l border-border',
              )}
            >
              <Text className={cn('text-sm', on ? 'font-ui-medium text-accent' : 'text-text')}>
                {PROVIDER_LABELS[provider]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <NotchSlider
        label="Quality"
        value={qualityIndex}
        notches={QUALITY_ORDER.map((q) => QUALITY_LABELS[q])}
        accessibilityLabel="Quality"
        onChange={(i) => onChange({ ...profile, quality: QUALITY_ORDER[i] as AiQuality })}
        hint={`${MODEL_HINTS[profile.provider][profile.quality]} · ${slug}`}
        tokens={tokens}
      />

      <NotchSlider
        label="Effort"
        value={effortIndex}
        notches={EFFORT_ORDER.map((e) => EFFORT_LABELS[e])}
        accessibilityLabel="Effort"
        onChange={(i) => onChange({ ...profile, effort: EFFORT_ORDER[i] as AiEffort })}
        hint={EFFORT_HINT}
        tokens={tokens}
      />
    </View>
  );
}

function NotchSlider({
  label,
  value,
  notches,
  onChange,
  hint,
  accessibilityLabel,
  tokens,
}: {
  label: string;
  value: number;
  notches: string[];
  onChange: (index: number) => void;
  hint: string;
  accessibilityLabel: string;
  tokens: ReturnType<typeof useAppTheme>['tokens'];
}) {
  return (
    <View>
      <View className="flex-row items-center justify-between">
        <Text className="font-ui-medium text-sm">{label}</Text>
        <Text variant="muted" className="text-sm">
          {notches[value]}
        </Text>
      </View>
      <Slider
        style={{ width: '100%', height: 40 }}
        minimumValue={0}
        maximumValue={notches.length - 1}
        step={1}
        value={value}
        onValueChange={(v) => {
          const next = Math.round(v);
          if (next !== value) onChange(next);
        }}
        minimumTrackTintColor={tokens.accent}
        maximumTrackTintColor={tokens.textMuted}
        thumbTintColor={tokens.text}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: notches[value] }}
      />
      <View className="flex-row justify-between px-1">
        {notches.map((n, i) => (
          <Text
            key={n}
            variant="caption"
            className={cn('text-xs', i === value && 'font-ui-medium text-accent')}
          >
            {n}
          </Text>
        ))}
      </View>
      <Text variant="caption" className="mt-1">
        {hint}
      </Text>
    </View>
  );
}
