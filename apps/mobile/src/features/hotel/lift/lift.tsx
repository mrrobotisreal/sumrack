import * as Haptics from 'expo-haptics';
import * as React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { CallPanel } from './call-buttons';
import { Doors } from './doors';
import {
  DROP_DIGITS,
  DROP_OPEN_MS,
  DROP_REDUCED_FADE_MS,
  DROP_SILENCE_MS,
  DROP_SPIN_STEP_MS,
  DROP_STUTTER_DIMS,
  DROP_STUTTER_MS,
} from './drop';
import {
  DOORS_CLOSE_MS,
  DOORS_OPEN_MS,
  DOORS_WIDTH_DP,
  FLICKER_BLACKOUT_MS,
  FLICKER_MS,
  TOAST_MS,
} from './lift-constants';
import { Indicator, type Titles } from './indicator';
import { createLiftSfx, readHotelSfxEnabled, type LiftSfx } from './lift-sfx';
import {
  closeDoors,
  fadeIn,
  fadeOut,
  jolt1,
  openDoors,
  openDropDoors,
  shake,
  snapOpen,
  startDrift,
  stopDrift,
  type LiftMotion,
} from './motion';
import {
  crossesMissing13,
  downLit,
  floorAbove,
  floorBelow,
  MISSING_FLOOR,
  planRide,
  upLit,
} from './ride-plan';

/**
 * T91 `<Lift>`: the hotel lift. A controlled component. It owns only the
 * animation state; the lock rule lives in T89's hotel-model.ts, and T92 wires
 * `highestUnlocked`, `onArrive` and the floor content.
 *
 * Ride (decision 5): doors close (650 ms), the car rides (planRide duration)
 * with the indicator stepping through each panel floor and a 2 px drift, then
 * the ding, then the doors open (650 ms). `onArrive(floor)` fires when the
 * doors start opening. Taps are ignored mid-ride.
 *
 * Flicker (decision 6): a step that crosses the gap between 12 and 14 (with 13
 * off the panel) shows «13» for 180 ms with two 60 ms blackouts, then the next
 * number. The motion is worklets (motion.ts); the JS timers only swap text.
 *
 * Drop (decision 7): the «13» button (reveal13) plays the cable-snap sequence.
 * Reduce-motion has no shake, spin or jolt: a 400 ms fade, with the sound and
 * the haptic still firing.
 */

export interface LiftProps {
  /** Ordered floors the car can stop at, e.g. [0,…,12,14,15] (13 only when revealed). */
  panel: readonly number[];
  /** The floor the car is on now (must be on the panel). */
  floor: number;
  /** The highest floor the learner has unlocked (the lock rule from T89). */
  highestUnlocked: number;
  /** Floor title for the indicator: ru and en. */
  titleFor: (floor: number) => Titles;
  /** Fires when the doors start opening on a new floor. */
  onArrive: (floor: number) => void;
  /** A tap on a dark ▲ (the Lift shows the toast and the clunk itself). */
  onBlockedUp: () => void;
  /** The floor content shown behind the doors once they open. */
  children?: React.ReactNode;
  /** Show the «13» button and allow the drop (floor 15 passed + mock installed). */
  reveal13: boolean;
  /** Fires after the drop's doors finish opening on Номер 13. */
  onRide13: () => void;
}

export function Lift({
  panel,
  floor,
  highestUnlocked,
  titleFor,
  onArrive,
  onBlockedUp,
  children,
  reveal13,
  onRide13,
}: LiftProps) {
  const { tokens: t } = useAppTheme();
  const reduced = useReduceMotion();

  const [shownFloor, setShownFloor] = React.useState(floor);
  const [displayText, setDisplayText] = React.useState<string | null>(null);
  const [dimmed, setDimmed] = React.useState(false);
  const [riding, setRiding] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // Taps are ignored mid-ride and mid-drop.
  const busy = React.useRef(false);
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  const sfxRef = React.useRef<LiftSfx | null>(null);
  const onArriveRef = React.useRef(onArrive);
  const onRide13Ref = React.useRef(onRide13);
  const onBlockedRef = React.useRef(onBlockedUp);
  React.useEffect(() => {
    onArriveRef.current = onArrive;
    onRide13Ref.current = onRide13;
    onBlockedRef.current = onBlockedUp;
  });

  // Motion lives on the UI thread (motion.ts worklets). The bag is built once.
  const open = useSharedValue(1);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  const jolt = useSharedValue(0);
  const drift = useSharedValue(0);
  const fade = useSharedValue(1);
  const [motion] = React.useState<LiftMotion>(() => ({ open, shakeX, shakeY, jolt, drift, fade }));

  /** Schedules a timer that is cleared on unmount. */
  const after = React.useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  // SFX players are created once per mount and released on unmount.
  React.useEffect(() => {
    let cancelled = false;
    void readHotelSfxEnabled().then((enabled) => {
      if (!cancelled) sfxRef.current = createLiftSfx(enabled);
    });
    const pending = timers.current;
    return () => {
      cancelled = true;
      for (const id of pending) clearTimeout(id);
      pending.clear();
      sfxRef.current?.dispose();
      sfxRef.current = null;
      cancelAnimation(motion.shakeX);
      cancelAnimation(motion.shakeY);
      cancelAnimation(motion.jolt);
      cancelAnimation(motion.drift);
      cancelAnimation(motion.fade);
    };
  }, [motion]);

  // A controlled floor change from outside moves the car without a ride.
  React.useEffect(() => {
    if (!busy.current) setShownFloor(floor);
  }, [floor]);

  const flashToast = React.useCallback(
    (text: string) => {
      setToast(text);
      after(TOAST_MS, () => setToast(null));
    },
    [after],
  );

  /** The 13 flicker (decision 6): 180 ms at 40 %, two 60 ms blackouts, the buzz. */
  const flicker = React.useCallback(
    (next: () => void) => {
      sfxRef.current?.play('flicker');
      setDisplayText('13');
      setDimmed(true);
      after(FLICKER_BLACKOUT_MS, () => setDisplayText(''));
      after(FLICKER_BLACKOUT_MS * 2, () => setDisplayText('13'));
      after(FLICKER_MS, () => {
        setDisplayText(null);
        setDimmed(false);
        next();
      });
    },
    [after],
  );

  const ride = React.useCallback(
    (to: number) => {
      if (busy.current || to === shownFloor) return;
      busy.current = true;
      const plan = planRide(panel, shownFloor, to);
      track('hotel_lift_ride', { from: shownFloor, to, passed13: plan.passes13 });

      sfxRef.current?.play('close');
      closeDoors(motion)();

      after(DOORS_CLOSE_MS, () => {
        setRiding(true);
        sfxRef.current?.startRide();
        startDrift(motion)();
        const stepMs = plan.durationMs / Math.max(1, plan.steps.length);
        let prev = shownFloor;
        let i = 0;

        const arrive = () => {
          stopDrift(motion)();
          setRiding(false);
          sfxRef.current?.stopRide(120);
          sfxRef.current?.play('ding');
          setShownFloor(to);
          after(120, () => {
            onArriveRef.current(to);
            sfxRef.current?.play('open');
            openDoors(motion)();
            after(DOORS_OPEN_MS, () => {
              busy.current = false;
            });
          });
        };

        const step = () => {
          if (i >= plan.steps.length) {
            arrive();
            return;
          }
          const target = plan.steps[i]!;
          i += 1;
          const crossing =
            crossesMissing13(panel, prev, target) && adjacentGap(panel, prev, target);
          const advance = () => {
            prev = target;
            setShownFloor(target);
            after(stepMs, step);
          };
          if (crossing) flicker(advance);
          else advance();
        };
        step();
      });
    },
    [shownFloor, panel, after, flicker, motion],
  );

  const onUpPress = React.useCallback(() => {
    if (busy.current) return;
    const above = floorAbove(panel, shownFloor);
    if (above !== null && above <= highestUnlocked) {
      ride(above);
      return;
    }
    // Dark ▲: the clunk, a light haptic, the toast, and the caller's hook (decision 4).
    track('hotel_up_blocked', { floor: shownFloor });
    sfxRef.current?.play('blocked');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    flashToast('Сначала сдайте экзамен этажа');
    onBlockedRef.current();
  }, [panel, shownFloor, highestUnlocked, ride, flashToast]);

  const onDownPress = React.useCallback(() => {
    if (busy.current) return;
    const below = floorBelow(panel, shownFloor);
    if (below !== null) ride(below);
  }, [panel, shownFloor, ride]);

  const runDrop = React.useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    sfxRef.current?.play('drop');
    track('hotel_drop_played', { reduced });
    const landing = panel.includes(MISSING_FLOOR) ? MISSING_FLOOR : shownFloor;

    if (reduced) {
      // Fade variant (decision 7): a 400 ms fade out, the doors open on 13 at the
      // blackout, a 400 ms fade in. The haptic still fires.
      fadeOut(motion)();
      after(DROP_REDUCED_FADE_MS, () => {
        setShownFloor(landing);
        setDisplayText(null);
        snapOpen(motion)();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        fadeIn(motion)();
        after(DROP_REDUCED_FADE_MS, () => {
          busy.current = false;
          onRide13Ref.current();
        });
      });
      return;
    }

    // Normal motion: the stutter, the spin 15 → 14 → 13, the shake, the jolt.
    setDimmed(true);
    for (let k = 1; k < DROP_STUTTER_DIMS; k++) {
      after(DROP_STUTTER_MS * (k / DROP_STUTTER_DIMS), () => setDimmed((d) => !d));
    }
    after(DROP_STUTTER_MS, () => setDimmed(false));

    // The spin: each digit lasts DROP_SPIN_STEP_MS (chained timeouts, no interval).
    DROP_DIGITS.forEach((digit, n) => {
      after(DROP_STUTTER_MS + DROP_SPIN_STEP_MS * n, () => setDisplayText(digit));
    });

    shake(motion)();

    const impactAt = DROP_STUTTER_MS + DROP_SPIN_STEP_MS * DROP_DIGITS.length;
    after(impactAt, () => {
      setShownFloor(landing);
      setDisplayText(null);
      jolt1(motion)();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    });

    // 600 ms of silence, then the creak open.
    after(impactAt + DROP_SILENCE_MS, () => {
      sfxRef.current?.play('open', { rate: 0.8 });
      openDropDoors(motion)();
    });

    after(impactAt + DROP_SILENCE_MS + DROP_OPEN_MS, () => {
      setDimmed(false);
      busy.current = false;
      onRide13Ref.current();
    });
  }, [reduced, panel, shownFloor, after, motion]);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: motion.shakeX.value },
      { translateY: motion.shakeY.value + motion.jolt.value + motion.drift.value },
    ],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: motion.fade.value }));

  const upOn = upLit(panel, shownFloor, highestUnlocked);
  // The unlock moment (D4): ▲ lights while the car stands on this floor → one ding.
  const upWasOn = React.useRef(upOn);
  React.useEffect(() => {
    if (upOn && !upWasOn.current && !riding) sfxRef.current?.play('ding');
    upWasOn.current = upOn;
  }, [upOn, riding]);
  const downOn = downLit(panel, shownFloor);

  return (
    <Animated.View style={[shakeStyle, fadeStyle, { alignItems: 'center', gap: 16 }]}>
      <Indicator
        display={displayText ?? String(shownFloor)}
        titles={titleFor(shownFloor)}
        reduced={reduced}
        dimmed={dimmed}
      />

      <Doors open={open} width={DOORS_WIDTH_DP}>
        {children}
      </Doors>

      <CallPanel
        upLit={upOn && !riding}
        downLit={downOn && !riding}
        onUp={onUpPress}
        onDown={onDownPress}
        reduced={reduced}
        show13={reveal13}
        onRide13={runDrop}
        disabled={riding}
      />

      {toast ? (
        <Pressable
          accessibilityRole="alert"
          onPress={() => setToast(null)}
          style={{ backgroundColor: t.hotelPlate, borderColor: t.hotelBrass }}
          className="rounded-xl border px-4 py-2"
        >
          <Text style={{ color: t.hotelGlow }} className="font-ui">
            Сначала сдайте экзамен этажа
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** True when `from` and `to` are the two floors that sit either side of the missing 13. */
function adjacentGap(panel: readonly number[], from: number, to: number): boolean {
  const a = panel.indexOf(from);
  const b = panel.indexOf(to);
  if (a < 0 || b < 0 || Math.abs(a - b) !== 1) return false;
  return (from === 12 && to === 14) || (from === 14 && to === 12);
}
