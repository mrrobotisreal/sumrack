import { useColorScheme } from 'nativewind';

import { colors, type ColorTokens, type ThemeScheme } from '@/theme/colors';
import { navThemes } from '@/theme/navigation';

/**
 * Resolves the *effective* color scheme (the theme store's dark/light/system
 * mode already applied to NativeWind) and exposes the token values for the
 * few native surfaces NativeWind classes can't style (nav chrome, status bar).
 */
export function useAppTheme(): {
  scheme: ThemeScheme;
  tokens: ColorTokens;
  navTheme: (typeof navThemes)[ThemeScheme];
} {
  const { colorScheme } = useColorScheme();
  const scheme: ThemeScheme = colorScheme ?? 'dark';
  return { scheme, tokens: colors[scheme], navTheme: navThemes[scheme] };
}
