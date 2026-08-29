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
  /** Last successful backup per target (T20/T21): { at, name } — Zod-validated on read. */
  lastBackupGithub: 'lastBackup.github',
  lastBackupSyncd: 'lastBackup.syncd',
  lastBackupLocal: 'lastBackup.local',
  /**
   * Backup targets/schedule prefs (T20): { githubEnabled, autoEnabled } —
   * Zod-validated on read (features/backup/config).
   */
  backupPrefs: 'backup.prefs',
  /**
   * Backup KDF parameters (T20): { saltB64, iterations, createdAt }. The
   * salt is NOT secret; the passphrase-derived key lives in secure-store
   * only ('sumrak.backup.key'), never here.
   */
  backupKdf: 'backup.kdf',
  /** SAF directory uri granted for local backup export/restore (T20). */
  backupSafDir: 'backup.safDirUri',
  /**
   * syncd target config (T21): { host } — the tailnet base URL, Zod-validated
   * on read (features/backup/syncd-config). The bearer token is NEVER here:
   * secure-store only ('sumrak.backup.syncd.token'), same rule as the PAT.
   */
  syncdConfig: 'backup.syncd',
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
  /**
   * boolean (T27, default false): dialogue choices default to tap-to-choose
   * instead of voice-first (silent environments; mic stays available).
   */
  dialogueTapMode: 'games.dialogueTapMode',
  /**
   * boolean (T31, default false): still every ambient animation — room
   * scenes freeze on their poster frame, the threshold transition and the
   * house-map flicker are skipped. OR-combined with the OS reduced-motion
   * flag (store/motion-prefs.ts); Zod-validated on hydrate.
   */
  reduceMotion: 'motion.reduce',
  /**
   * Daily-session composition (T14): { length, weights: { flashcard, mc,
   * cloze, sentenceBuilder, listening } } — Zod-validated on read
   * (store/daily-prefs.ts), corrupt values fall back to defaults.
   */
  dailySessionPrefs: 'dailySession.prefs',
  /**
   * Checkpoint/unit-quiz pass threshold (T17), fraction 0–1, default 0.8 —
   * Zod-validated on read (features/path/threshold.ts).
   */
  checkpointPassThreshold: 'path.checkpointPassThreshold',
  /**
   * OpenRouter model id (T16), e.g. 'anthropic/claude-sonnet-5' — validated
   * on read (features/ai/config). The API key is NEVER here: secure-store
   * only (same rule as the GitHub PAT).
   */
  aiModel: 'ai.model',
  /**
   * Daily goal (T19, §7.7): { reviews, readingMin } — Zod-validated on read
   * (features/motivation/goal-prefs), defaults 20 reviews + 10 min reading.
   */
  dailyGoal: 'goal.daily',
  /**
   * Streak-freeze wallet (T19): { available 0–2, lastEarnedOnDate } —
   * Zod-validated on read (features/motivation/freeze). Per-day coverage
   * audit lives in the `frozen_days` table, not here.
   */
  streakFreeze: 'streak.freeze',
  /**
   * Notification prefs (T19): master toggle, reminder times, quiet hours —
   * Zod-validated on read (features/motivation/notification-prefs).
   */
  notificationPrefs: 'notifications.prefs',
  /** boolean (T19): the one-time "enable reminders" Today card was dismissed. */
  notificationPromptDismissed: 'notifications.promptDismissed',
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
