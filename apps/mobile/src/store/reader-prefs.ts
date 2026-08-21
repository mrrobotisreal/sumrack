import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

/**
 * Reader typography preferences (UI_DESIGN §2: size 5 steps, line-height
 * 3 steps, serif↔sans). Persisted in the `settings` table like the theme
 * mode: DbProvider hydrates once after migrations, setters write through
 * fire-and-forget. Steps are indices into the scales in
 * src/features/reader/typography.ts — stored as indices so the underlying
 * px values can be retuned without migrating stored prefs.
 */
export interface ReaderPrefs {
  /** 0–4 into READER_SIZE_STEPS; 2 = the §2 default (~19px). */
  sizeStep: number;
  /** 0–2 into READER_LINE_HEIGHT_STEPS; 1 = the §2 default (1.6). */
  lineHeightStep: number;
  /** true = Literata (reading serif), false = Golos (UI sans). */
  serif: boolean;
}

interface ReaderPrefsState extends ReaderPrefs {
  setPrefs: (patch: Partial<ReaderPrefs>) => void;
}

const DEFAULTS: ReaderPrefs = { sizeStep: 2, lineHeightStep: 1, serif: true };

const clampStep = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));

function sanitize(prefs: Partial<ReaderPrefs>): Partial<ReaderPrefs> {
  const out: Partial<ReaderPrefs> = {};
  if (typeof prefs.sizeStep === 'number') out.sizeStep = clampStep(prefs.sizeStep, 4);
  if (typeof prefs.lineHeightStep === 'number')
    out.lineHeightStep = clampStep(prefs.lineHeightStep, 2);
  if (typeof prefs.serif === 'boolean') out.serif = prefs.serif;
  return out;
}

export const useReaderPrefs = create<ReaderPrefsState>((set, get) => ({
  ...DEFAULTS,
  setPrefs: (patch) => {
    const clean = sanitize(patch);
    set(clean);
    const { sizeStep, lineHeightStep, serif } = get();
    track('reader_typography_changed', { sizeStep, lineHeightStep, serif });
    void repos.settings.set(SETTING_KEYS.readerTypography, { sizeStep, lineHeightStep, serif });
  },
}));

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateReaderPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<Partial<ReaderPrefs>>(SETTING_KEYS.readerTypography);
  if (stored && typeof stored === 'object') {
    useReaderPrefs.setState(sanitize(stored));
  }
}
