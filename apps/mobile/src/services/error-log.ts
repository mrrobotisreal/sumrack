import { File, Paths } from 'expo-file-system';

import { track } from '@/services/analytics';

import {
  appendEntry,
  describeError,
  emptyLog,
  parseLogFile,
  serializeLog,
  type ErrorLogEntry,
  type ErrorLogFile,
  type ErrorScope,
} from './error-log-core';

/**
 * On-device error log (T22 crash guard). File-backed (documentDirectory/
 * error-log.json) rather than DB-backed on purpose: the most important
 * error to capture is "the database failed to open", and this log must
 * still work then. Every function here is deliberately unable to throw.
 */

const LOG_FILE_NAME = 'error-log.json';

let cached: ErrorLogFile | null = null;

function logFile(): File {
  return new File(Paths.document, LOG_FILE_NAME);
}

function readLog(): ErrorLogFile {
  if (cached) return cached;
  try {
    const file = logFile();
    cached = file.exists ? parseLogFile(file.textSync()) : emptyLog();
  } catch {
    cached = emptyLog();
  }
  return cached;
}

function persist(log: ErrorLogFile): void {
  cached = log;
  try {
    logFile().write(serializeLog(log));
  } catch {
    // Storage failure must never cascade — the in-memory copy still serves
    // the viewer for this session.
  }
}

/**
 * Record an error. Safe to call from anywhere, any time, with anything —
 * never throws, never recurses.
 */
export function logError(scope: ErrorScope, err: unknown, opts?: { fatal?: boolean }): void {
  try {
    const { message, stack } = describeError(err);
    const entry: ErrorLogEntry = {
      ts: Date.now(),
      scope,
      message,
      ...(stack ? { stack } : {}),
      ...(opts?.fatal ? { fatal: true } : {}),
    };
    persist(appendEntry(readLog(), entry));
    // Count it in local analytics too — scope/fatal only, never the
    // message (messages may quote user content; the log file is enough).
    track('app_error', { scope, fatal: opts?.fatal === true });
  } catch {
    // Swallow everything: an error logger that throws is worse than none.
  }
}

/** All entries, oldest-first (viewer reverses). */
export function getErrorLog(): ErrorLogEntry[] {
  return readLog().entries;
}

export function clearErrorLog(): void {
  persist(emptyLog());
  try {
    const file = logFile();
    if (file.exists) file.delete();
  } catch {
    // Already cleared in memory; the next persist rewrites the file.
  }
  cached = emptyLog();
}

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalErrorHandler | undefined;
  setGlobalHandler(handler: GlobalErrorHandler): void;
}
interface HermesInternalLike {
  enablePromiseRejectionTracker?: (opts: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
  }) => void;
}

let installed = false;

/**
 * Install the process-wide capture hooks: RN's global error handler (JS
 * exceptions that escape everything) and Hermes' unhandled-promise-
 * rejection tracker. Chains to the previous handler so dev RedBox and
 * RN's native fatal handling keep working exactly as before.
 */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      logError('global', error, { fatal: isFatal === true });
      previous?.(error, isFatal);
    });
  }

  const hermes = (globalThis as { HermesInternal?: HermesInternalLike }).HermesInternal;
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => {
      logError('promise', rejection);
      console.warn('[error-log] unhandled promise rejection', rejection);
    },
  });
}
