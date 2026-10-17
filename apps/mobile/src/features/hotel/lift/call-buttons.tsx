import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * T91 call panel: ▲ above ▼, two round brass buttons (56 dp). A lit button has
 * a glowing ring and is enabled; a dark button is grey, has no glow, and stays
 * tappable (a tap calls `onPress` so the Lift can show the blocked feedback).
 * The optional «13» button (reveal13 only) is brass-red with a glow.
 */

export const BUTTON_DP = 56;

export interface CallButtonProps {
  label: string;
  /** Glowing ring + enabled look. */
  lit: boolean;
  /** Accessibility label. */
  a11y: string;
  onPress: () => void;
  reduced: boolean;
  /** Warm red-amber glow variant for the Номер 13 button. */
  accentGlow?: boolean;
  testID?: string;
  /** A debrief marker on the next floor this button calls (T92d): a small amber dot. */
  marked?: boolean;
}

export function CallButton({
  label,
  lit,
  a11y,
  onPress,
  reduced,
  accentGlow,
  testID,
  marked,
}: CallButtonProps) {
  const { tokens: t } = useAppTheme();
  const glow = useSharedValue(lit ? 1 : 0);
  // The unlock moment (HOTEL_PATH D4): a button that lights while mounted
  // flashes brighter for 300 ms before settling into its pulse.
  const flash = useSharedValue(1);
  const wasLit = React.useRef(lit);

  React.useEffect(() => {
    if (lit && !wasLit.current && !reduced) {
      flash.value = withSequence(
        withTiming(1.6, { duration: 150 }),
        withTiming(1, { duration: 150 }),
      );
    }
    wasLit.current = lit;
  }, [lit, reduced, flash]);

  React.useEffect(() => {
    if (!lit || reduced) {
      cancelAnimation(glow);
      glow.value = lit ? 1 : 0;
      return;
    }
    glow.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    return () => cancelAnimation(glow);
  }, [lit, reduced, glow]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    shadowOpacity: lit ? glow.value : 0,
    transform: [{ scale: flash.value > 1 ? 1 + (flash.value - 1) * 0.15 : 1 }],
    shadowRadius: 10 * flash.value,
  }));

  const ringColor = accentGlow ? '#E0602E' : t.hotelGlow;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !lit }}
      testID={testID}
      hitSlop={8}
      style={{ width: BUTTON_DP, height: BUTTON_DP }}
    >
      <Animated.View
        style={[
          ringStyle,
          {
            position: 'absolute',
            inset: 0,
            borderRadius: BUTTON_DP / 2,
            borderWidth: lit ? 2 : 1,
            borderColor: lit ? ringColor : t.hotelBrass,
            shadowColor: ringColor,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <View
        style={{
          width: BUTTON_DP,
          height: BUTTON_DP,
          borderRadius: BUTTON_DP / 2,
          backgroundColor: t.hotelPlate,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: lit ? (accentGlow ? '#E0602E' : t.hotelGlow) : t.textMuted,
            fontSize: label.length > 1 ? 18 : 22,
            fontFamily: 'Literata_700Bold',
            opacity: lit ? 1 : 0.55,
          }}
        >
          {label}
        </Text>
        {marked ? (
          <View
            testID={testID ? `${testID}-marker` : undefined}
            accessibilityLabel="Отмечено на лифте"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: t.hotelGlow,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export interface CallPanelProps {
  upLit: boolean;
  downLit: boolean;
  onUp: () => void;
  onDown: () => void;
  reduced: boolean;
  /** Show the «13» button above the arrows (reveal13 only). */
  show13: boolean;
  onRide13: () => void;
  disabled?: boolean;
  /** Debrief markers (T92d): which way has a marked floor next. */
  markUp?: boolean;
  markDown?: boolean;
}

export function CallPanel({
  upLit,
  downLit,
  onUp,
  onDown,
  reduced,
  show13,
  onRide13,
  disabled,
  markUp,
  markDown,
}: CallPanelProps) {
  return (
    <View className="items-center gap-3">
      {show13 && (
        <CallButton
          label="13"
          lit
          a11y="Номер 13"
          accentGlow
          reduced={reduced}
          onPress={disabled ? () => {} : onRide13}
          testID="lift-13"
        />
      )}
      <CallButton
        label="▲"
        lit={upLit}
        a11y={upLit ? 'Выше' : 'Выше — закрыто'}
        reduced={reduced}
        onPress={onUp}
        testID="lift-up"
        marked={markUp}
      />
      <CallButton
        label="▼"
        lit={downLit}
        a11y="Ниже"
        reduced={reduced}
        onPress={onDown}
        testID="lift-down"
        marked={markDown}
      />
    </View>
  );
}
