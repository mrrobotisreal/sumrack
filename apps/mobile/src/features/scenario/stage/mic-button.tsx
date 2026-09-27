import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The mic button (T62 §9.3): 72 px, an accent ring that grows with the mic
 * level while recording, a pulsing halo while the host is waiting
 * (`listening`), dimmed while the host speaks. Tap = tap-to-talk (the JS
 * endpointer ends it); long-press (≥ 350 ms) = hold-to-talk until release.
 * `holdPrimary` swaps the hint text only — both gestures always work.
 */

export type MicVisualState = 'disabled' | 'ready' | 'recording' | 'processing';

const SIZE = 72;
const HALO = 112;
const HOLD_MS = 350;

export function MicButton({
  state,
  level,
  holdPrimary,
  onTap,
  onHoldStart,
  onHoldEnd,
}: {
  state: MicVisualState;
  /** Normalized RMS 0..1 (only meaningful while recording). */
  level: number;
  holdPrimary: boolean;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const { tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const recording = state === 'recording';
  const ready = state === 'ready';

  // Halo pulse while ready (UI thread, reanimated); still under reduce-motion.
  const pulse = useSharedValue(0);
  React.useEffect(() => {
    if (ready && !reduceMotion) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(ready ? 0.5 : 0, { duration: 200 });
    }
  }, [ready, reduceMotion, pulse]);
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + pulse.value * 0.22,
    transform: [{ scale: 0.92 + pulse.value * 0.12 }],
  }));

  // Level ring: RMS 0.05–0.3 → a visible 0..1 (the T12 record-button mapping).
  const ringScale = recording ? 1 + Math.min(0.45, level * 2.2) : 1;

  // Handlers live in a ref the gestures read on touch events only (the T05
  // token-text pattern); the gestures themselves are built once.
  const handlersRef = React.useRef({ onTap, onHoldStart, onHoldEnd, holding: false });
  React.useEffect(() => {
    handlersRef.current.onTap = onTap;
    handlersRef.current.onHoldStart = onHoldStart;
    handlersRef.current.onHoldEnd = onHoldEnd;
  });
  // False positive: Gesture's .onX() methods *register* event handlers —
  // the closures (and thus the ref) only run on touch events, never render.
  // eslint-disable-next-line react-hooks/refs
  const [gesture] = React.useState(() => {
    const tap = Gesture.Tap()
      .maxDuration(HOLD_MS)
      .runOnJS(true)
      .onEnd((_e, success) => {
        const h = handlersRef.current;
        if (success && !h.holding) h.onTap();
      });
    const hold = Gesture.LongPress()
      .minDuration(HOLD_MS)
      .maxDistance(40)
      .runOnJS(true)
      .onStart(() => {
        const h = handlersRef.current;
        h.holding = true;
        h.onHoldStart();
      })
      .onFinalize(() => {
        const h = handlersRef.current;
        if (h.holding) {
          h.holding = false;
          h.onHoldEnd();
        }
      });
    return Gesture.Exclusive(hold, tap);
  });
  const enabled = state === 'ready' || state === 'recording';

  const label =
    state === 'disabled'
      ? 'Wait for the host'
      : state === 'processing'
        ? 'Thinking'
        : recording
          ? 'Stop recording'
          : holdPrimary
            ? 'Hold to talk'
            : 'Tap to talk';

  return (
    <View style={styles.wrap} accessibilityLabel={label} accessibilityRole="button">
      {ready && (
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { backgroundColor: tokens.accent }, haloStyle]}
        />
      )}
      {recording && (
        <View
          pointerEvents="none"
          style={[styles.ring, { borderColor: tokens.accent, transform: [{ scale: ringScale }] }]}
        />
      )}
      <GestureDetector gesture={gesture}>
        <View
          style={[
            styles.button,
            {
              backgroundColor: recording ? tokens.danger : tokens.accent,
              opacity: enabled ? 1 : 0.35,
            },
          ]}
          pointerEvents={enabled ? 'auto' : 'none'}
        >
          <Ionicons
            name={recording ? 'stop' : state === 'processing' ? 'ellipsis-horizontal' : 'mic'}
            size={30}
            color={tokens.bg}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: HALO, height: HALO, borderRadius: HALO / 2 },
  ring: {
    position: 'absolute',
    width: SIZE + 14,
    height: SIZE + 14,
    borderRadius: (SIZE + 14) / 2,
    borderWidth: 3,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
