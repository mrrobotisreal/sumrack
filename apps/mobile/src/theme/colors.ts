/**
 * TS mirror of the theme tokens in src/global.css — ONLY for the places
 * NativeWind classes cannot reach: the react-navigation theme, status bar,
 * and native chrome. Components must use token classes (bg-bg, text-text…),
 * never these values directly. Keep in sync with global.css.
 */
export type ThemeScheme = 'dark' | 'light';

export interface ColorTokens {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  danger: string;
  border: string;
  /** Warm «Семья»-track identity (T30) — icons/SVG the class system can't reach. */
  trackWarm: string;
  /** Backdrop/shadow wash base (always used WITH an alpha) — scene layers (T31). */
  scrim: string;
}

export const colors: Record<ThemeScheme, ColorTokens> = {
  dark: {
    bg: '#0B0B0E',
    surface: '#141419',
    surface2: '#1C1C24',
    text: '#E8E6E3',
    textMuted: '#9A97A0',
    accent: '#B3402F',
    success: '#708C5A',
    danger: '#CE6A60',
    border: '#26262E',
    trackWarm: '#C08A4A',
    scrim: '#000000',
  },
  light: {
    bg: '#F7F5F2',
    surface: '#FFFFFF',
    surface2: '#EFECE7',
    text: '#1A1A1F',
    textMuted: '#6B6870',
    accent: '#A03828',
    success: '#5A7548',
    danger: '#96322B',
    border: '#E2DED8',
    trackWarm: '#8F6534',
    scrim: '#000000',
  },
};
