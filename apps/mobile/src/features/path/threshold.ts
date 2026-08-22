import { z } from 'zod';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

/**
 * Pass threshold for checkpoints AND unit quizzes (T17, design §7.5:
 * "configurable threshold, default 80%"). Stored as a fraction in settings;
 * Zod-validated on read so a corrupt value heals to the default.
 */
export const DEFAULT_PASS_THRESHOLD = 0.8;

/** The options Settings offers — a test you can pass at <60% isn't a test. */
export const PASS_THRESHOLD_OPTIONS = [0.6, 0.7, 0.8, 0.9] as const;

const ThresholdSchema = z.number().min(0.5).max(1);

export async function getPassThreshold(): Promise<number> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.checkpointPassThreshold);
  const parsed = ThresholdSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PASS_THRESHOLD;
}

export async function setPassThreshold(value: number): Promise<void> {
  await repos.settings.set(SETTING_KEYS.checkpointPassThreshold, ThresholdSchema.parse(value));
}
