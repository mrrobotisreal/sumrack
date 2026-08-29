import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, G } from 'react-native-svg';

import {
  RadialGlow,
  SceneWash,
  shadowWash,
  useAmbientValue,
  Vignette,
  type SceneLayerProps,
} from './layers';
import { SCENE_PRIMARY_LOOP_MS, withAlpha } from './scene-palette';

const LOOP = SCENE_PRIMARY_LOOP_MS.nursery; // 20000 — one full, patient rotation

/**
 * «Детская» — slow rotating mobile shadows (V2 §5.3): five soft spokes
 * turning above the crib for no one, lit by a pale window glow. Poster
 * frame = the mobile mid-turn, spokes visible.
 */
export function NurseryScene({ active, palette, width, height }: SceneLayerProps) {
  const turn = useAmbientValue(active, 0, () =>
    withRepeat(withTiming(1, { duration: LOOP, easing: Easing.linear }), -1),
  );
  const mobileStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 360}deg` }],
  }));

  // A square wider than the screen, centered on the hub so rotation is about
  // the mobile's own center.
  const size = width * 1.5;
  const hubX = width * 0.56;
  const hubY = height * 0.3;
  const spokes = [0, 72, 144, 216, 288];

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.24, 0.3)} />
      {/* pale window light the shadows turn through */}
      <RadialGlow
        id="nursery-window"
        color={palette.mist}
        alpha={0.09}
        cx={0.56}
        cy={0.3}
        rx={0.5}
        ry={0.38}
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: hubX - size / 2,
              top: hubY - size / 2,
              width: size,
              height: size,
            },
            mobileStyle,
          ]}
        >
          <Svg width={size} height={size}>
            <G origin={`${size / 2}, ${size / 2}`}>
              {spokes.map((deg) => (
                <Ellipse
                  key={deg}
                  cx={size / 2}
                  cy={size / 2 - size * 0.19}
                  rx={size * 0.028}
                  ry={size * 0.14}
                  fill={withAlpha(palette.shadow, 0.16)}
                  rotation={deg}
                  origin={`${size / 2}, ${size / 2}`}
                />
              ))}
            </G>
          </Svg>
          {/* the hub — a small dark heart the spokes hang from */}
          <View
            style={{
              position: 'absolute',
              left: size / 2 - 5,
              top: size / 2 - 5,
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: withAlpha(palette.shadow, 0.3),
            }}
          />
        </Animated.View>
      </View>
      <Vignette id="nursery-vignette" shadow={palette.shadow} strength={0.44} />
    </>
  );
}
