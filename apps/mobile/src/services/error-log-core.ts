import { z } from 'zod';

/**
 * Pure logic for the local error log (T22): entry shape, ring-buffer
 * append, and tolerant (de)serialization. The file-system side lives in
 * error-log.ts; this module stays Node-testable.
 *
 * The log is the local-first half of "exceptionally good analytics":
 * errors are also counted as analytics events, but the full message/stack
 * only ever lands in this on-device file — never in any remote system.
 */

export const ERROR_LOG_MAX_ENTRIES = 200;

export const ErrorScopeSchema = z.enum(['render', 'global', 'promise', 'db', 'manual']);
export type ErrorScope = z.infer<typeof ErrorScopeSchema>;

export const ErrorLogEntrySchema = z.object({
  /** Epoch ms at capture time. */
  ts: z.number().int().nonnegative(),
  scope: ErrorScopeSchema,
  message: z.string(),
  stack: z.string().optional(),
  /** True when the RN global handler flagged the error fatal. */
  fatal: z.boolean().optional(),
});
export type ErrorLogEntry = z.infer<typeof ErrorLogEntrySchema>;

const ErrorLogFileSchema = z.object({
  v: z.literal(1),
  entries: z.array(ErrorLogEntrySchema),
});
export type ErrorLogFile = z.infer<typeof ErrorLogFileSchema>;

export function emptyLog(): ErrorLogFile {
  return { v: 1, entries: [] };
}

/**
 * Append an entry, trimming the oldest entries beyond the cap. Entries are
 * stored oldest-first; the viewer reverses for display.
 */
export function appendEntry(
  log: ErrorLogFile,
  entry: ErrorLogEntry,
  max: number = ERROR_LOG_MAX_ENTRIES,
): ErrorLogFile {
  const entries = [...log.entries, entry];
  return { v: 1, entries: entries.length > max ? entries.slice(entries.length - max) : entries };
}

/**
 * Parse the persisted log file. Any corruption (partial write, schema
 * drift) degrades to an empty log — the error log must never itself be a
 * source of errors.
 */
export function parseLogFile(text: string): ErrorLogFile {
  try {
    const parsed = ErrorLogFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyLog();
  } catch {
    return emptyLog();
  }
}

export function serializeLog(log: ErrorLogFile): string {
  return JSON.stringify(log);
}

/** Normalize an unknown thrown value into message + stack. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Error', stack: err.stack };
  }
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}
