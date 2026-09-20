import { StableIdSchema } from '@sumrak/schema';
import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { ALL_GENRES } from '@/features/library/categories';

/**
 * Library shelf filter (M14, LIBRARY_CATEGORIES §4.4) — the reader-prefs.ts
 * pattern: DbProvider hydrates once after migrations (and restore-service
 * re-hydrates after a restore), setters write through fire-and-forget under
 * SETTING_KEYS.libraryFilter. T45's chip rows read and drive this store;
 * nothing in T44 renders it.
 */
export interface LibraryPrefs {
  /** Selected category slug (known or forward-compatible unknown). */
  category: string;
  /** Selected genre slug inside «Истории», or ALL_GENRES ('all'). */
  genre: string;
}

interface LibraryPrefsState extends LibraryPrefs {
  /** Switching category always resets the genre to «Все» (§4.4). */
  setCategory: (category: string) => void;
  setGenre: (genre: string) => void;
}

export const LIBRARY_PREFS_DEFAULTS: LibraryPrefs = { category: 'stories', genre: ALL_GENRES };

/**
 * Stored-shape guard. Each field is validated independently: a malformed
 * value (non-string, empty, not a kebab-case StableId) heals to its default
 * while the other field survives. An unknown-but-WELL-FORMED slug is kept on
 * purpose — the design's "unknown → stories" wording is read as "malformed →
 * default": dropping a slug the app doesn't know yet would defeat the
 * forward-compatible sets (§1.2), and T45 renders unknown slugs with their
 * raw label anyway. 'all' is a valid StableId, so the genre default needs no
 * special case.
 */
const FieldSchema = StableIdSchema;

export function sanitize(raw: unknown): LibraryPrefs {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const category = FieldSchema.safeParse(obj.category);
  const genre = FieldSchema.safeParse(obj.genre);
  return {
    category: category.success ? category.data : LIBRARY_PREFS_DEFAULTS.category,
    genre: genre.success ? genre.data : LIBRARY_PREFS_DEFAULTS.genre,
  };
}

function persist(get: () => LibraryPrefs) {
  const { category, genre } = get();
  void repos.settings.set(SETTING_KEYS.libraryFilter, { category, genre });
}

export const useLibraryPrefs = create<LibraryPrefsState>((set, get) => ({
  ...LIBRARY_PREFS_DEFAULTS,
  setCategory: (category) => {
    const clean = sanitize({ category, genre: ALL_GENRES });
    set({ category: clean.category, genre: ALL_GENRES });
    persist(get);
  },
  setGenre: (genre) => {
    set({ genre: sanitize({ genre }).genre });
    persist(get);
  },
}));

/** Load the persisted filter after the DB is ready (DbProvider + post-restore). */
export async function hydrateLibraryPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.libraryFilter);
  // No row yet → keep the defaults untouched (a first run has nothing to heal).
  if (stored === null || stored === undefined) {
    useLibraryPrefs.setState(LIBRARY_PREFS_DEFAULTS);
    return;
  }
  useLibraryPrefs.setState(sanitize(stored));
}
