import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useReaderPrefs } from '@/store/reader-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { READER_SIZE_STEPS, readingTextStyle } from './typography';

/** Maps 1:1 onto READER_LINE_HEIGHT_STEPS (1.4 / 1.6 / 1.8). */
const LINE_HEIGHT_LABELS = ['Tight', 'Normal', 'Airy'] as const;

/**
 * In-reader typography sheet (bottom-anchored — thumb-reachable per
 * UI_DESIGN §4): size stepper (5), line-height segmented (3), serif↔sans.
 * Live preview line so changes read instantly.
 */
export function TypeSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useAppTheme();
  const prefs = useReaderPrefs();

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* backdrop */}
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4">
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Typography</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close typography settings">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        {/* live preview */}
        <View className="mb-5 rounded-xl bg-surface-2 px-4 py-3">
          <RNText style={[readingTextStyle(prefs), { color: tokens.text }]} numberOfLines={2}>
            Ночью в стене кто-то тихо стучит…
          </RNText>
        </View>

        {/* size stepper */}
        <View className="mb-4 flex-row items-center justify-between">
          <Text variant="muted">Size</Text>
          <View className="flex-row items-center gap-3">
            <StepButton
              label="A−"
              small
              disabled={prefs.sizeStep === 0}
              onPress={() => prefs.setPrefs({ sizeStep: prefs.sizeStep - 1 })}
            />
            <View className="flex-row gap-1.5">
              {READER_SIZE_STEPS.map((_, i) => (
                <View
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i <= prefs.sizeStep ? 'bg-accent' : 'bg-border',
                  )}
                />
              ))}
            </View>
            <StepButton
              label="A+"
              disabled={prefs.sizeStep === READER_SIZE_STEPS.length - 1}
              onPress={() => prefs.setPrefs({ sizeStep: prefs.sizeStep + 1 })}
            />
          </View>
        </View>

        {/* line height */}
        <View className="mb-4 flex-row items-center justify-between">
          <Text variant="muted">Line height</Text>
          <Segmented
            options={[...LINE_HEIGHT_LABELS]}
            selected={prefs.lineHeightStep}
            onSelect={(i) => prefs.setPrefs({ lineHeightStep: i })}
          />
        </View>

        {/* typeface */}
        <View className="flex-row items-center justify-between">
          <Text variant="muted">Typeface</Text>
          <Segmented
            options={['Literata', 'Golos']}
            selected={prefs.serif ? 0 : 1}
            onSelect={(i) => prefs.setPrefs({ serif: i === 0 })}
          />
        </View>
      </View>
    </Modal>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label === 'A−' ? 'Smaller text' : 'Larger text'}
      className={cn(
        'h-10 w-12 items-center justify-center rounded-lg border border-border bg-surface-2 active:bg-border',
        disabled && 'opacity-40',
      )}
    >
      <Text className={cn('font-ui-medium', small ? 'text-sm' : 'text-base')}>{label}</Text>
    </Pressable>
  );
}

function Segmented({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-lg border border-border">
      {options.map((opt, i) => (
        <Pressable
          key={opt}
          onPress={() => onSelect(i)}
          accessibilityRole="radio"
          accessibilityState={{ selected: i === selected }}
          className={cn(
            'px-3 py-2.5',
            i === selected ? 'bg-accent-soft' : 'bg-surface-2 active:bg-border',
            i > 0 && 'border-l border-border',
          )}
        >
          <Text
            className={cn('text-sm', i === selected ? 'font-ui-medium text-accent' : 'text-text')}
          >
            {opt}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
