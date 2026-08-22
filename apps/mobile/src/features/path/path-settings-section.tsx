import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';

import {
  DEFAULT_PASS_THRESHOLD,
  getPassThreshold,
  PASS_THRESHOLD_OPTIONS,
  setPassThreshold,
} from './threshold';

/**
 * Guided-path settings (T17): the pass threshold for checkpoints and unit
 * quizzes (design §7.5 — default 80%, configurable).
 */
export function PathSettingsSection() {
  const [threshold, setThresholdState] = React.useState<number>(DEFAULT_PASS_THRESHOLD);

  React.useEffect(() => {
    void getPassThreshold().then(setThresholdState);
  }, []);

  const choose = (value: number) => {
    setThresholdState(value);
    void setPassThreshold(value);
    track('checkpoint_threshold_changed', { threshold: value });
  };

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Guided path
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <View className="px-4 py-3.5">
          <Text className="font-ui-medium">Pass mark</Text>
          <Text variant="caption">
            Score needed to pass checkpoints and unit quizzes (default 80%)
          </Text>
          <View className="mt-3 flex-row gap-2">
            {PASS_THRESHOLD_OPTIONS.map((option) => {
              const selected = threshold === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => choose(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`flex-1 items-center rounded-full border py-2 ${
                    selected
                      ? 'border-accent bg-accent/15'
                      : 'border-border bg-surface-2 active:bg-border'
                  }`}
                >
                  <RNText
                    className={`font-ui-medium text-sm ${selected ? 'text-accent' : 'text-text'}`}
                  >
                    {Math.round(option * 100)}%
                  </RNText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}
