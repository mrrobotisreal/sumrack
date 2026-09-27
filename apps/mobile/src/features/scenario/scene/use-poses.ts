import * as React from 'react';
import type { ViewStyle } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useAmbientValue } from '@/features/path/scenes/layers';

import {
  BLINK_GAPS_MS,
  BLINK_MS,
  BREATH_PERIOD_MS,
  BREATH_SCALE_MAX,
  BREATH_TRANSLATE_PX,
  POSE_SETTLE_MS,
  poseTargets,
  TILT_DEGREES,
  TILT_PERIOD_MS,
  type PoseTargets,
  type ScenePose,
} from './poses';

/**
 * Pose + blink motion (T61, §8.1 items 4 and 6) as reanimated shared values:
 * loops (breathing, tilt, blink) run through T31's `useAmbientValue` so they
 * freeze on the poster when `active` is false (reduce-motion, background);
 * settles (lean, brow, gaze, glow) tween to the pose's targets. Everything
 * here is decoration — the mouth's shared value lives in `use-mouth-track`.
 */

export type AnimatedViewStyle = ReturnType<typeof useAnimatedStyle<ViewStyle>>;

export interface PoseMotion {
  /** Whole-character group: breathing translate/scale + lean. */
  bodyStyle: AnimatedViewStyle;
  /** Head-only group (placeholder) or the body again (PNG): the speaking tilt. */
  headStyle: AnimatedViewStyle;
  browStyle: AnimatedViewStyle;
  gazeStyle: AnimatedViewStyle;
  /** The host glow's opacity multiplier (1 … 1.1). */
  glow: SharedValue<number>;
  targets: PoseTargets;
}

export function usePoseMotion(
  pose: ScenePose,
  opts: { active: boolean; reduceMotion: boolean; png: boolean },
): PoseMotion {
  const targets = poseTargets(pose, { reduceMotion: opts.reduceMotion, png: opts.png });
  const run = opts.active && !opts.reduceMotion;

  const breath = useAmbientValue(run && targets.breathe, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: BREATH_PERIOD_MS / 2, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: BREATH_PERIOD_MS / 2, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );
  const tilt = useAmbientValue(run && targets.tilt, 0, () =>
    withRepeat(
      withSequence(
        withTiming(1, { duration: TILT_PERIOD_MS / 2, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1, { duration: TILT_PERIOD_MS / 2, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ),
  );

  const lean = useSharedValue(targets.leanX);
  const brow = useSharedValue(targets.browLift);
  const gazeX = useSharedValue(targets.gazeX);
  const gazeY = useSharedValue(targets.gazeY);
  const glow = useSharedValue(targets.glow);
  React.useEffect(() => {
    const cfg = { duration: run ? POSE_SETTLE_MS : 0, easing: Easing.out(Easing.quad) };
    lean.value = withTiming(targets.leanX, cfg);
    brow.value = withTiming(targets.browLift, cfg);
    gazeX.value = withTiming(targets.gazeX, cfg);
    gazeY.value = withTiming(targets.gazeY, cfg);
    glow.value = withTiming(targets.glow, cfg);
  }, [
    run,
    targets.leanX,
    targets.browLift,
    targets.gazeX,
    targets.gazeY,
    targets.glow,
    lean,
    brow,
    gazeX,
    gazeY,
    glow,
  ]);

  const bodyStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [
      { translateX: lean.value },
      { translateY: -breath.value * BREATH_TRANSLATE_PX },
      { scale: 1 + breath.value * (BREATH_SCALE_MAX - 1) },
    ],
  }));
  const headStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${tilt.value * TILT_DEGREES}deg` }],
  }));
  const browStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateY: brow.value }],
  }));
  const gazeStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateX: gazeX.value }, { translateY: gazeY.value }],
  }));

  return { bodyStyle, headStyle, browStyle, gazeStyle, glow, targets };
}

/**
 * Blink opacity 0→1→0 over 120 ms, then a gap from the irregular band
 * (2.8–6 s), looped on the UI thread (`withRepeat(withSequence(withDelay…)))`).
 * Frozen at 0 (eyes open) when not active.
 */
export function useBlink(active: boolean): SharedValue<number> {
  return useAmbientValue(active, 0, () =>
    withRepeat(
      withSequence(
        ...BLINK_GAPS_MS.flatMap((gap) => [
          withDelay(gap, withTiming(1, { duration: BLINK_MS / 2, easing: Easing.linear })),
          withTiming(0, { duration: BLINK_MS / 2, easing: Easing.linear }),
        ]),
      ),
      -1,
    ),
  );
}
