import { LinearGradient } from 'expo-linear-gradient';
import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
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

const LOOP = SCENE_PRIMARY_LOOP_MS['living-room']; // 12600 — curtain sway
const SHIMMER = 8300; // TV-static shimmer at a co-prime-ish period

/**
 * «Гостиная» — curtain sway + faint TV-static shimmer (V2 §5.3): a soft
 * curtain panel on the right edge swaying a few px/degrees, and a cold
 * mist-colored glow low in the room, wavering like a set left on. Poster
 * frame = curtain at rest, screen dimly on.
 */
export function LivingRoomScene({ active, palette }: SceneLayerProps) {
  const sway = useAmbientValue(active, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );
  const curtainStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sway.value * 7 }, { skewX: `${(sway.value - 0.5) * 2.4}deg` }],
  }));

  // Two uneven layers make the static's waver feel unmetered.
  const shimmerA = useAmbientValue(active, 0.75, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: SHIMMER * 0.32, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.55, { duration: SHIMMER * 0.41, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.75, { duration: SHIMMER * 0.27, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    ),
  );
  const shimmerB = useAmbientValue(active, 1, () =>
    withRepeat(
      withSequence(
        withTiming(0.7, { duration: 11300 * 0.5, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 11300 * 0.5, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );
  const staticStyle = useAnimatedStyle(() => ({ opacity: shimmerA.value * shimmerB.value }));

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.24, 0.3)} />
      {/* the set nobody turned on — cold shimmer low center-left */}
      <Animated.View style={[StyleSheet.absoluteFill, staticStyle]}>
        <RadialGlow
          id="living-room-tv"
          color={palette.mist}
          alpha={0.11}
          cx={0.38}
          cy={0.62}
          rx={0.34}
          ry={0.24}
        />
      </Animated.View>
      {/* curtain panel along the right edge */}
      <Animated.View
        style={[{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '26%' }, curtainStyle]}
      >
        <LinearGradient
          colors={[withAlpha(palette.shadow, 0), withAlpha(palette.shadow, 0.34)] as const}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        {/* one fold catching the room's light */}
        <LinearGradient
          colors={
            [
              withAlpha(palette.glow, 0),
              withAlpha(palette.glow, 0.06),
              withAlpha(palette.glow, 0),
            ] as const
          }
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[StyleSheet.absoluteFill, { left: '30%', right: '40%' }]}
        />
      </Animated.View>
      <Vignette id="living-room-vignette" shadow={palette.shadow} strength={0.42} />
    </>
  );
}
