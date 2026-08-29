import * as React from 'react';
import { StyleSheet, View } from 'react-native';
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

const LOOP = SCENE_PRIMARY_LOOP_MS.hallway; // 9300 — the flicker sequence total
const BREATH = 13700; // co-prime-ish second layer so the flicker never feels periodic

/**
 * «Прихожая» — a lamp's glow flickering irregularly + dust motes (V2 §5.3).
 * Irregularity = one uneven flicker sequence × one slower breath layer at a
 * non-multiple period. Poster frame = lamp steadily lit, motes hanging.
 */
// The flicker's non-hold segments total 5900 ms; the long steady hold makes
// up the rest of the LOOP budget so the sequence sums to it exactly.
const FLICKER_HOLD = LOOP - 5900;

export function HallwayScene({ active, palette, width, height }: SceneLayerProps) {
  // Uneven dips with long steady holds — a tired bulb, never a strobe.
  const flicker = useAmbientValue(active, 1, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: FLICKER_HOLD, easing: Easing.linear }),
        withTiming(0.72, { duration: 180, easing: Easing.linear }),
        withTiming(0.96, { duration: 140, easing: Easing.linear }),
        withTiming(0.8, { duration: 260, easing: Easing.linear }),
        withTiming(1, { duration: 220, easing: Easing.linear }),
        withTiming(1, { duration: 4200, easing: Easing.linear }),
        withTiming(0.85, { duration: 160, easing: Easing.linear }),
        withTiming(1, { duration: 740, easing: Easing.linear }),
      ),
      -1,
    ),
  );
  const breath = useAmbientValue(active, 1, () =>
    withRepeat(
      withSequence(
        withTiming(0.82, { duration: BREATH * 0.5, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: BREATH * 0.5, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    ),
  );
  const lampStyle = useAnimatedStyle(() => ({ opacity: flicker.value * breath.value }));

  return (
    <>
      <SceneWash colors={shadowWash(palette.shadow, 0.26, 0.3)} />
      <Animated.View style={[StyleSheet.absoluteFill, lampStyle]}>
        <RadialGlow
          id="hallway-lamp"
          color={palette.glow}
          alpha={0.16}
          cx={0.3}
          cy={0.2}
          rx={0.42}
          ry={0.3}
        />
      </Animated.View>
      <DustMotes
        active={active}
        color={withAlpha(palette.mist, 0.35)}
        width={width}
        height={height}
      />
      <Vignette id="hallway-vignette" shadow={palette.shadow} strength={0.42} />
    </>
  );
}

const MOTES = [
  { left: 0.24, top: 0.18, size: 3, drift: 46, duration: 15500 },
  { left: 0.34, top: 0.32, size: 2, drift: 34, duration: 18700 },
  { left: 0.44, top: 0.14, size: 2, drift: 52, duration: 17300 },
  { left: 0.58, top: 0.26, size: 3, drift: 40, duration: 19900 },
] as const;

/** Dust hanging in the lamplight — tiny dots drifting down and back (yoyo, no snap). */
function DustMotes({
  active,
  color,
  width,
  height,
}: {
  active: boolean;
  color: string;
  width: number;
  height: number;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {MOTES.map((mote, i) => (
        <Mote
          key={i}
          active={active}
          color={color}
          x={mote.left * width}
          y={mote.top * height}
          size={mote.size}
          drift={mote.drift}
          duration={mote.duration}
        />
      ))}
    </View>
  );
}

function Mote({
  active,
  color,
  x,
  y,
  size,
  drift,
  duration,
}: {
  active: boolean;
  color: string;
  x: number;
  y: number;
  size: number;
  drift: number;
  duration: number;
}) {
  const fall = useAmbientValue(active, 0, () =>
    withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true),
  );
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value * drift }, { translateX: fall.value * drift * 0.2 }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
