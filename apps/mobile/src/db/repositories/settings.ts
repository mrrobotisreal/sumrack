import { eq } from 'drizzle-orm';

import { settings } from '../schema';
import type { SumrakDB } from '../types';

/**
 * Well-known settings keys. Add here as tickets introduce them so key
 * strings stay discoverable in one place.
 */
export const SETTING_KEYS = {
  /** 'dark' | 'light' | 'system' — migrated from the T01 AsyncStorage store. */
  themeMode: 'themeMode',
  /** Guided-path position (T17). */
  pathPosition: 'pathPosition',
  /** Marks first-run bootstrap (fixture auto-import) as completed. */
  bootstrapDone: 'bootstrapDone',
  /** Reader typography prefs (T04): { sizeStep, lineHeightStep, serif }. */
  readerTypography: 'readerTypography',
  /** boolean (T05): tap-lookup on a banked lemma records an encounter by itself. */
  encounterOnLookup: 'encounterOnLookup',
  /** Last backup ids per target (T20/T21). */
  lastBackupGithub: 'lastBackup.github',
  lastBackupSyncd: 'lastBackup.syncd',
  /** Content sync source (T07): { owner, repo, branch } — the PAT lives in secure-store, never here. */
  contentRepo: 'sync.contentRepo',
  /** boolean (T07, default true): only download narration audio on Wi-Fi. */
  wifiOnlyAudio: 'sync.wifiOnlyAudio',
  /** Epoch ms of the last manifest auto-check (T07 throttle). */
  lastSyncCheckAt: 'sync.lastCheckAt',
  /** Narration playback prefs (T10): { rate } — validated on read in use-narration. */
  narrationPrefs: 'narration.prefs',
  /** TTS voice selection (T11): { selectedVoiceId } — Zod-validated on read (features/tts/catalog). */
  ttsVoice: 'tts.voice',
  /**
   * boolean (T13, default false): cloze/sentence-builder may quote sentences
   * from stories not yet read. Off = never spoil an unseen story.
   */
  clozeUnseenStoriesAllowed: 'games.clozeUnseenStoriesAllowed',
} as const;

/** Key-value settings, JSON-encoded values. */
export function createSettingsRepo(db: SumrakDB) {
  return {
    async get<T>(key: string): Promise<T | null> {
      const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      const row = rows[0];
      return row ? (row.value as T) : null;
    },

    async set(key: string, value: unknown): Promise<void> {
      const now = Date.now();
      await db
        .insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
    },

    async remove(key: string): Promise<void> {
      await db.delete(settings).where(eq(settings.key, key));
    },

    async getAll(): Promise<Record<string, unknown>> {
      const rows = await db.select().from(settings);
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
