import {
  Easing,
  runOnUI,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  DROP_SHAKE_DP,
  DROP_SHAKE_MS,
  DROP_JOLT_DP,
  DROP_OPEN_MS,
  DROP_REDUCED_FADE_MS,
} from './drop';
import { DOORS_CLOSE_MS, DOORS_OPEN_MS, DRIFT_DP, DRIFT_HALF_MS } from './lift-constants';

/**
 * T91 motion: every animated value the lift drives. Each function is a UI-thread
 * worklet (`runOnUI`), so the JS thread only says WHEN to move and the
 * animation itself runs on the UI thread. This is the repo's token-text
 * pattern, and it keeps the React rule from seeing writes to captured values.
 */

export interface LiftMotion {
  open: SharedValue<number>;
  shakeX: SharedValue<number>;
  shakeY: SharedValue<number>;
  jolt: SharedValue<number>;
  drift: SharedValue<number>;
  fade: SharedValue<number>;
}

export const closeDoors = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.open.value = withTiming(0, { duration: DOORS_CLOSE_MS, easing: Easing.inOut(Easing.ease) });
  });

export const openDoors = (m: LiftMotion, duration: number = DOORS_OPEN_MS) =>
  runOnUI(() => {
    'worklet';
    m.open.value = withTiming(1, { duration, easing: Easing.out(Easing.ease) });
  });

/** Snap the doors open with no animation (reduced-motion fade variant). */
export const snapOpen = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.open.value = 1;
  });

/** The 2 px vertical drift while the car rides, looping until stopped. */
export const startDrift = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.drift.value = withRepeat(
      withSequence(
        withTiming(DRIFT_DP, { duration: DRIFT_HALF_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: DRIFT_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  });

export const stopDrift = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.drift.value = withTiming(0, { duration: 120 });
  });

/** The screen shake: ±6 dp decaying over 900 ms, with a vertical counter-beat. */
export const shake = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.shakeX.value = withSequence(
      withTiming(DROP_SHAKE_DP, { duration: 60 }),
      withTiming(-DROP_SHAKE_DP, { duration: 90 }),
      withTiming(0, { duration: DROP_SHAKE_MS - 150, easing: Easing.out(Easing.quad) }),
    );
    m.shakeY.value = withSequence(
      withTiming(-DROP_SHAKE_DP / 2, { duration: 70 }),
      withTiming(DROP_SHAKE_DP / 2, { duration: 80 }),
      withTiming(0, { duration: DROP_SHAKE_MS - 150, easing: Easing.out(Easing.quad) }),
    );
  });

/** The hard jolt at impact: one 14 dp drop and a settle. */
export const jolt1 = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.jolt.value = withSequence(
      withTiming(DROP_JOLT_DP, { duration: 60 }),
      withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) }),
    );
  });

/** The reduced-motion fade: out, then back in. */
export const fadeOut = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.fade.value = withTiming(0, {
      duration: DROP_REDUCED_FADE_MS,
      easing: Easing.in(Easing.ease),
    });
  });

export const fadeIn = (m: LiftMotion) =>
  runOnUI(() => {
    'worklet';
    m.fade.value = withTiming(1, {
      duration: DROP_REDUCED_FADE_MS,
      easing: Easing.out(Easing.ease),
    });
  });

/** The creak open on Номер 13 uses the same open path with the slower 1100 ms duration. */
export const openDropDoors = (m: LiftMotion) => openDoors(m, DROP_OPEN_MS);
