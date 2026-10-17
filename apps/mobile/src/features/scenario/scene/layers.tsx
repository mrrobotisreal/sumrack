import { LinearGradient } from 'expo-linear-gradient';
import * as React from 'react';
import { StyleSheet } from 'react-native';
import { cancelAnimation, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';

import { withAlpha, type ScenePalette } from './scene-palette';

/** What every scene module receives from RoomScene. */
export interface SceneLayerProps {
  /** Focused + app foregrounded + motion allowed — false freezes on the poster frame. */
  active: boolean;
  palette: ScenePalette;
  /** The scene box (a full screen OR an expanded unit card) — never window dims. */
  width: number;
  height: number;
}

/**
 * The tiny shared layer toolkit for room scenes (T31): a gradient wash, a
 * radial glow, a vignette, and the one hook that manages an ambient shared
 * value's run/freeze lifecycle. All layers are STATIC — motion comes only
 * from Animated.View wrappers transforming/fading them on the UI thread, so
 * nothing re-rasterizes per frame.
 */

/**
 * One ambient shared value: runs `build()`'s animation while `active`,
 * otherwise freezes on the poster value (the scene's meaningful static
 * first frame — reduce-motion, blur, and backgrounding all land here).
 */
export function useAmbientValue(
  active: boolean,
  poster: number,
  build: () => number,
): SharedValue<number> {
  const sv = useSharedValue(poster);
  React.useEffect(() => {
    cancelAnimation(sv);
    sv.value = poster;
    if (active) {
      sv.value = build();
    }
    return () => cancelAnimation(sv);
    // `build` is an inline animation recipe — new identity every render but
    // the same animation; re-running on it would restart loops for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, poster, sv]);
  return sv;
}

/** Full-bleed vertical wash — colors are token-derived rgba() strings. */
export function SceneWash({ colors }: { colors: readonly [string, string, ...string[]] }) {
  return <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />;
}

/**
 * A soft radial light blob. Position/size are fractions of the scene box.
 * `id` must be unique within one scene (SVG gradient defs are per-id).
 */
export function RadialGlow({
  id,
  color,
  alpha,
  cx,
  cy,
  rx,
  ry,
}: {
  id: string;
  color: string;
  alpha: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={alpha} />
          <Stop offset="60%" stopColor={color} stopOpacity={alpha * 0.45} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse
        cx={`${cx * 100}%`}
        cy={`${cy * 100}%`}
        rx={`${rx * 100}%`}
        ry={`${ry * 100}%`}
        fill={`url(#${id})`}
      />
    </Svg>
  );
}

/**
 * Darkness closing in from the edges: transparent center, shadow edges.
 * On the near-black dark theme this reads as a whisper; pair it with a
 * center glow so the breathing stays perceptible in both themes.
 */
export function Vignette({
  id,
  shadow,
  strength,
}: {
  id: string;
  shadow: string;
  strength: number;
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="47%" rx="72%" ry="62%">
          <Stop offset="0%" stopColor={shadow} stopOpacity={0} />
          <Stop offset="62%" stopColor={shadow} stopOpacity={0} />
          <Stop offset="100%" stopColor={shadow} stopOpacity={strength} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Convenience: the standard top+bottom shadow wash most scenes open with. */
export function shadowWash(shadow: string, top: number, bottom: number) {
  return [withAlpha(shadow, top), withAlpha(shadow, 0), withAlpha(shadow, bottom)] as const;
}
