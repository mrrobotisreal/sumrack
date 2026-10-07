import { z } from 'zod';

/**
 * `torfl.media` — the exam media-bundle ledger (T74, TORFL §8.5). The
 * `exam_attempts` table has no bundle columns and T74 ships no migration,
 * so the per-attempt bundle state lives in ONE healed settings row:
 *
 *   { v: 1, attempts: { [attemptId]: { state, name } } }
 *
 * `state` mirrors `scenario_runs.mediaBundleState` (pending → uploaded |
 * failed); `name` is the bundle's file name on both targets
 * (`sumrak-media-exam-<attemptid>.json`, lowercase). The row is a user
 * setting, so it rides the snapshot like every other setting (§4.6): after
 * a wipe + restore the debrief still knows which attempts have an archived
 * bundle and offers «Скачать запись». Pure module, Node-tested.
 */

export const EXAM_BUNDLE_STATES = ['pending', 'uploaded', 'failed'] as const;
export type ExamBundleState = (typeof EXAM_BUNDLE_STATES)[number];

export interface ExamBundleEntry {
  state: ExamBundleState;
  name: string;
}

export interface ExamMediaLedger {
  v: 1;
  attempts: Record<string, ExamBundleEntry>;
}

export const DEFAULT_EXAM_MEDIA_LEDGER: ExamMediaLedger = { v: 1, attempts: {} };

const EntrySchema = z.strictObject({
  state: z.enum(EXAM_BUNDLE_STATES),
  name: z.string().min(1).max(120),
});

export const ExamMediaLedgerSchema = z.strictObject({
  v: z.literal(1),
  attempts: z.record(z.string().min(1), EntrySchema),
});

/** Heal entry by entry: a malformed entry is dropped, the rest survive. */
export function parseExamMediaLedger(raw: unknown): ExamMediaLedger {
  const whole = ExamMediaLedgerSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const attemptsRaw =
    obj.attempts !== null && typeof obj.attempts === 'object' && !Array.isArray(obj.attempts)
      ? (obj.attempts as Record<string, unknown>)
      : {};
  const attempts: Record<string, ExamBundleEntry> = {};
  for (const [id, entry] of Object.entries(attemptsRaw)) {
    const parsed = EntrySchema.safeParse(entry);
    if (parsed.success && id.length > 0) attempts[id] = parsed.data;
  }
  return { v: 1, attempts };
}

/**
 * The bundle stem for an exam attempt: `exam-<attemptId lowercased>`.
 * SumrakAPI `internal/naming/naming.go:24` accepts `^sumrak-media-([a-z0-9]
 * [a-z0-9-]{3,79})\.json$` — lowercase only — while app ids may carry
 * uppercase; lowercasing is the whole fix (no API change, ticket §3).
 */
export function examBundleStem(attemptId: string): string {
  return `exam-${attemptId.toLowerCase()}`;
}
