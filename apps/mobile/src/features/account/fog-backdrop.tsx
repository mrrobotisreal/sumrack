import * as React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/store/motion-prefs';

/**
 * The auth screen's backdrop (T102): two very slow, very faint ember-red fog
 * banks drifting in opposite directions over the void, with a crescent-glow
 * bloom behind the moon. UI-thread only (reanimated), ~40 s loops; frozen in
 * place under reduce-motion. Fixed palette like the splash — the intro and
 * the auth screen are one continuous brand moment.
 */
const EMBER = '#B3402F';
const GLOW = '#FF3B1F';

export function FogBackdrop({ paused }: { paused: boolean }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const drift = useSharedValue(0);
  const breathe = useSharedValue(0);

  React.useEffect(() => {
    if (reduceMotion || paused) {
      cancelAnimation(drift);
      cancelAnimation(breathe);
      return;
    }
    drift.value = withRepeat(
      withTiming(1, { duration: 40_000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    breathe.value = withRepeat(
      withTiming(1, { duration: 6_000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [reduceMotion, paused, drift, breathe]);

  const bankA = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * 0.35 + drift.value * width * 0.5 }],
  }));
  const bankB = useAnimatedStyle(() => ({
    transform: [{ translateX: width * 0.2 - drift.value * width * 0.55 }],
  }));
  const bloom = useAnimatedStyle(() => ({ opacity: 0.05 + breathe.value * 0.04 }));

  const bank = (top: number, size: number, opacity: number) => ({
    position: 'absolute' as const,
    top,
    width: size,
    height: size * 0.42,
    borderRadius: size,
    backgroundColor: EMBER,
    opacity,
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: height * 0.04,
            alignSelf: 'center',
            width: width * 0.62,
            height: width * 0.62,
            borderRadius: width,
            backgroundColor: GLOW,
          },
          bloom,
        ]}
      />
      <Animated.View style={[bank(height * 0.38, width * 1.4, 0.07), bankA]} />
      <Animated.View style={[bank(height * 0.62, width * 1.6, 0.05), bankB]} />
      <Animated.View style={[bank(height * 0.85, width * 1.3, 0.06), bankA]} />
    </View>
  );
}
