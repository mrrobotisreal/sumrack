import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

/**
 * `scenario.recordings` (T63, SPEAKING_SCENARIOS §4.4): the local retention
 * policy for attempt recordings. Healed field-by-field like `scenario.prefs`.
 */

export interface RecordingsSettings {
  v: 1;
  pruneDays: number;
  capBytes: number;
  lastPruneAt: number | null;
}

export const DEFAULT_RECORDINGS_SETTINGS: RecordingsSettings = {
  v: 1,
  pruneDays: 30,
  capBytes: 300_000_000,
  lastPruneAt: null,
};

/** The Settings chips; anything else stored is still honoured. */
export const PRUNE_DAY_OPTIONS = [7, 30, 90] as const;
export const CAP_BYTE_OPTIONS = [100_000_000, 300_000_000, 1_000_000_000] as const;

const FieldSchemas = {
  pruneDays: z.number().int().min(1).max(3650),
  capBytes: z.number().int().min(10_000_000),
  lastPruneAt: z.number().int().nonnegative().nullable(),
} as const;

export const RecordingsSettingsSchema = z.strictObject({ v: z.literal(1), ...FieldSchemas });

export function parseRecordingsSettings(raw: unknown): RecordingsSettings {
  const whole = RecordingsSettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const value = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof typeof FieldSchemas>(key: K): RecordingsSettings[K] => {
    const parsed = FieldSchemas[key].safeParse(value[key]);
    return (
      parsed.success ? parsed.data : DEFAULT_RECORDINGS_SETTINGS[key]
    ) as RecordingsSettings[K];
  };
  return {
    v: 1,
    pruneDays: pick('pruneDays'),
    capBytes: pick('capBytes'),
    lastPruneAt: pick('lastPruneAt'),
  };
}

export async function getRecordingsSettings(): Promise<RecordingsSettings> {
  return parseRecordingsSettings(
    await repos.settings.get<unknown>(SETTING_KEYS.scenarioRecordings),
  );
}

export async function setRecordingsSettings(
  patch: Partial<Omit<RecordingsSettings, 'v'>>,
): Promise<RecordingsSettings> {
  const next = parseRecordingsSettings({ ...(await getRecordingsSettings()), ...patch });
  await repos.settings.set(SETTING_KEYS.scenarioRecordings, next);
  return next;
}
