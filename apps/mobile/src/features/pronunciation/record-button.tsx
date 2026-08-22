import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAppTheme } from '@/theme/use-app-theme';

export type RecordButtonState = 'idle' | 'recording' | 'processing';

interface RecordButtonProps {
  state: RecordButtonState;
  /** Live mic RMS 0..1 while recording — drives the level ring. */
  level: number;
  onPress: () => void;
}

/**
 * The `RecordButton` (UI_DESIGN §7): one large mic target, moody not
 * bouncy. Recording state swaps to the danger tone with a level ring that
 * breathes with input (plain View scale — no animation lib, respects
 * reduced-motion by being driven purely by real input).
 */
export function RecordButton({ state, level, onPress }: RecordButtonProps) {
  const { tokens } = useAppTheme();
  const recording = state === 'recording';
  // RMS of speech is ~0.05–0.3; map to a visible 0..1.
  const ringScale = recording ? 1 + Math.min(0.35, level * 2.2) : 1;

  return (
    <View className="items-center justify-center" style={{ width: 132, height: 132 }}>
      {recording && (
        <View
          className="absolute rounded-full bg-danger/20"
          style={{ width: 104, height: 104, transform: [{ scale: ringScale }] }}
        />
      )}
      <Pressable
        onPress={onPress}
        disabled={state === 'processing'}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : 'Record your pronunciation'}
        className={`h-20 w-20 items-center justify-center rounded-full ${
          recording ? 'bg-danger' : 'bg-accent'
        } ${state === 'processing' ? 'opacity-60' : 'active:opacity-80'}`}
      >
        {state === 'processing' ? (
          <ActivityIndicator color={tokens.bg} />
        ) : (
          <Ionicons name={recording ? 'stop' : 'mic'} size={30} color={tokens.bg} />
        )}
      </Pressable>
    </View>
  );
}
