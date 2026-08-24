/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // All colors resolve through CSS variables defined in src/global.css —
      // that file is the single place token VALUES live. Never hardcode colors
      // in components; use these token classes (bg-bg, text-text, etc.).
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        // accent at 15% — selection washes, highlight, karaoke word bg
        'accent-soft': 'rgb(var(--accent) / 0.15)',
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        scrim: 'rgb(var(--scrim) / <alpha-value>)',
        // CEFR chip hue ramp (A1 coolest → C1 ember) — used via LevelChip only
        'level-a1': 'rgb(var(--level-a1) / <alpha-value>)',
        'level-a2': 'rgb(var(--level-a2) / <alpha-value>)',
        'level-b1': 'rgb(var(--level-b1) / <alpha-value>)',
        'level-b2': 'rgb(var(--level-b2) / <alpha-value>)',
        'level-c1': 'rgb(var(--level-c1) / <alpha-value>)',
      },
      fontFamily: {
        // UI chrome: Golos Text (Cyrillic-friendly, used for the Russian tab titles)
        ui: ['GolosText_400Regular'],
        'ui-medium': ['GolosText_500Medium'],
        'ui-bold': ['GolosText_700Bold'],
        // Display / branding (Сумрак wordmark): dripping-paint horror, Cyrillic-capable
        display: ['RubikWetPaint_400Regular'],
        // Reading (Russian story content): Literata with real Cyrillic italics
        reading: ['Literata_400Regular'],
        'reading-bold': ['Literata_700Bold'],
        'reading-italic': ['Literata_400Regular_Italic'],
        // Error log stack traces (T22) — Android generic monospace
        mono: ['monospace'],
      },
      fontSize: {
        // UI type scale per UI_DESIGN §2: 12 / 14 / 16 / 20 / 24 / 30
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['20px', { lineHeight: '28px' }],
        xl: ['24px', { lineHeight: '32px' }],
        '2xl': ['30px', { lineHeight: '38px' }],
        // Story text default ~19px/1.6 (user-adjustable from T04)
        reading: ['19px', { lineHeight: '30px' }],
      },
    },
  },
  plugins: [],
};
