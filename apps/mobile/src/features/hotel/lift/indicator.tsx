import * as React from 'react';
import { View } from 'react-native';
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
 * T91 floor indicator: the glowing floor number over a dark brass plate, the
 * floor title under it. The glow is a text shadow plus an opacity pulse on the
 * UI thread (2.4 s, 0.75 ↔ 1.0). Reduce-motion holds the number at full glow.
 */

export const PULSE_MS = 2400;
export const PULSE_MIN = 0.75;
/** The flicker and the drop stutter dim the number to 40 %. */
export const DIM_OPACITY = 0.4;

export interface Titles {
  ru: string;
  en: string;
}

export interface IndicatorProps {
  /** The number shown. An empty string is a blackout frame (the flicker). */
  display: string;
  titles: Titles;
  reduced: boolean;
  /** Dim the whole plate (the lights stutter during the drop). */
  dimmed?: boolean;
}

export function Indicator({ display, titles, reduced, dimmed }: IndicatorProps) {
  const { tokens: t } = useAppTheme();
  const pulse = useSharedValue(1);

  React.useEffect(() => {
    if (reduced) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(PULSE_MIN, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={{ backgroundColor: t.hotelPlate, borderColor: t.hotelBrass }}
      className="items-center rounded-2xl border px-6 py-4"
    >
      <Animated.View style={[glowStyle, { opacity: dimmed ? DIM_OPACITY : undefined }]}>
        <Text
          accessibilityRole="header"
          accessibilityLabel={`Этаж ${display}`}
          style={{
            color: t.hotelGlow,
            textShadowColor: t.hotelGlow,
            textShadowRadius: 12,
            textShadowOffset: { width: 0, height: 0 },
            fontSize: 44,
            lineHeight: 50,
            fontFamily: 'Literata_700Bold',
            textAlign: 'center',
          }}
        >
          {display}
        </Text>
      </Animated.View>
      <Text
        style={{ color: t.hotelGlowDim, fontSize: 18, lineHeight: 24, marginTop: 4 }}
        className="text-center font-ui-medium"
      >
        {titles.ru}
      </Text>
      <Text
        style={{ fontSize: 12, lineHeight: 16 }}
        className="text-center font-ui text-text-muted"
      >
        {titles.en}
      </Text>
    </View>
  );
}
