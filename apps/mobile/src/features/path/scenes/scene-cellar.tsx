import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  RadialGlow,
  SceneWash,
  shadowWash,
  useAmbientValue,
  Vignette,
  type SceneLayerProps,
} from './layers';
import { SCENE_PRIMARY_LOOP_MS, withAlpha } from './scene-palette';

const LOOP = SCENE_PRIMARY_LOOP_MS.cellar; // 18600 — fog there-and-back
const DRIP_MS = 11000; // ripple every ~11 s (2.4 s bloom + long quiet)

/**
 * «Подвал» — drifting fog band + occasional drip ripple (V2 §5.3): a low
 * mist crossing the room, and every so often a ring spreading where a drop
 * lands. Poster frame = fog mid-room, water still.
 */
export function CellarScene({ active, palette, width }: SceneLayerProps) {
  const drift = useAmbientValue(active, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );
  const fogStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (drift.value - 0.5) * width * 0.16 }],
  }));

  // 0→1 bloom, then a held silence, then an instant reset nobody sees
  // (opacity is 0 at both ends of the hold).
  const drip = useAmbientValue(active, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: DRIP_MS - 2401 }),
        withTiming(0, { duration: 1 }),
      ),
      -1,
    ),
  );
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(drip.value, [0, 0.06, 0.75, 1], [0, 0.3, 0, 0]),
    transform: [{ scale: 0.25 + drip.value * 1.3 }],
  }));

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.34, 0.38)} />
      {/* fog band low across the room */}
      <Animated.View style={[StyleSheet.absoluteFill, fogStyle]}>
        <RadialGlow
          id="cellar-fog"
          color={palette.mist}
          alpha={0.12}
          cx={0.5}
          cy={0.58}
          rx={0.62}
          ry={0.16}
        />
      </Animated.View>
      {/* the drip — a thin ring spreading on unseen water */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: '56%',
              top: '66%',
              width: 72,
              height: 28,
              marginLeft: -36,
              marginTop: -14,
              borderRadius: 36,
              borderWidth: 1.5,
              borderColor: withAlpha(palette.mist, 0.6),
            },
            rippleStyle,
          ]}
        />
      </View>
      {/* the dark that waits with you */}
      <Vignette id="cellar-vignette" shadow={palette.shadow} strength={0.56} />
    </>
  );
}
