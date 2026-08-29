import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Polygon, Stop } from 'react-native-svg';

import {
  RadialGlow,
  SceneWash,
  shadowWash,
  useAmbientValue,
  Vignette,
  type SceneLayerProps,
} from './layers';
import { SCENE_PRIMARY_LOOP_MS } from './scene-palette';

const LOOP = SCENE_PRIMARY_LOOP_MS.kitchen; // 9400 — one full swing there-and-back
const SWING_DEG = 3;

/**
 * «Кухня» — a hanging bulb swinging shadows a few degrees (V2 §5.3): a
 * light cone from the top center rocking ±3°, pivoting at the bulb. Poster
 * frame = bulb at rest, cone straight down.
 */
export function KitchenScene({ active, palette, width, height }: SceneLayerProps) {
  const swing = useAmbientValue(active, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1, { duration: LOOP * 0.5, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );
  const coneStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swing.value * SWING_DEG}deg` }],
  }));

  const coneW = width * 0.72;
  const coneH = height * 0.56;

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.28, 0.32)} />
      {/* the cone pivots at the bulb — transform origin top center */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              left: (width - coneW) / 2,
              width: coneW,
              height: coneH,
              transformOrigin: 'top center',
            },
            coneStyle,
          ]}
        >
          <Svg width={coneW} height={coneH}>
            <Defs>
              <SvgLinearGradient id="kitchen-cone" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={palette.glow} stopOpacity={0.18} />
                <Stop offset="55%" stopColor={palette.glow} stopOpacity={0.07} />
                <Stop offset="100%" stopColor={palette.glow} stopOpacity={0} />
              </SvgLinearGradient>
            </Defs>
            <Polygon
              points={`${coneW * 0.46},0 ${coneW * 0.54},0 ${coneW},${coneH} 0,${coneH}`}
              fill="url(#kitchen-cone)"
            />
          </Svg>
          {/* the bulb itself — a small hot point at the pivot */}
          <RadialGlow
            id="kitchen-bulb"
            color={palette.glow}
            alpha={0.5}
            cx={0.5}
            cy={0.015}
            rx={0.06}
            ry={0.035}
          />
        </Animated.View>
      </View>
      <Vignette id="kitchen-vignette" shadow={palette.shadow} strength={0.46} />
    </>
  );
}
