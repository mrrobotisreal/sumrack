import type { Theme } from 'expo-router';

import { colors, type ThemeScheme } from '@/theme/colors';

const fonts: Theme['fonts'] = {
  regular: { fontFamily: 'GolosText_400Regular', fontWeight: '400' },
  medium: { fontFamily: 'GolosText_500Medium', fontWeight: '500' },
  bold: { fontFamily: 'GolosText_700Bold', fontWeight: '700' },
  heavy: { fontFamily: 'GolosText_700Bold', fontWeight: '700' },
};

function makeNavTheme(scheme: ThemeScheme): Theme {
  const c = colors[scheme];
  return {
    dark: scheme === 'dark',
    colors: {
      primary: c.accent,
      background: c.bg,
      card: c.surface,
      text: c.text,
      border: c.border,
      notification: c.accent,
    },
    fonts,
  };
}

export const navThemes: Record<ThemeScheme, Theme> = {
  dark: makeNavTheme('dark'),
  light: makeNavTheme('light'),
};
