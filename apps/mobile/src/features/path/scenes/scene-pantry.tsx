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

const LOOP = SCENE_PRIMARY_LOOP_MS.pantry;

/**
 * «Кладовая» — breathing darkness (V2 §5.3): the vignette + a dim center
 * glow scale 1.00→1.03 and back. On the dark theme the glow carries the
 * breath; on warm paper the vignette does. Poster frame = fully exhaled
 * (scale 1.0, everything visible).
 */
export function PantryScene({ active, palette }: SceneLayerProps) {
  const breath = useAmbientValue(active, 1, () =>
    withRepeat(
      withSequence(
        withTiming(1.03, { duration: LOOP * 0.52, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: LOOP * 0.48, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    ),
  );
  const breathStyle = useAnimatedStyle(() => ({ transform: [{ scale: breath.value }] }));

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.22, 0.3)} />
      <Animated.View style={[StyleSheet.absoluteFill, breathStyle]}>
        <RadialGlow
          id="pantry-glow"
          color={palette.glow}
          alpha={0.1}
          cx={0.5}
          cy={0.44}
          rx={0.52}
          ry={0.4}
        />
        <Vignette id="pantry-vignette" shadow={palette.shadow} strength={0.5} />
      </Animated.View>
      {/* a faint colder seam low in the frame — the shelf line you can't quite see */}
      <SceneWash
        colors={
          [
            withAlpha(palette.shadow, 0),
            withAlpha(palette.mist, 0.03),
            withAlpha(palette.shadow, 0),
          ] as const
        }
      />
    </>
  );
}
