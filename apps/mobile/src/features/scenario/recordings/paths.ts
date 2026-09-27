import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where attempt recordings live (T63, SPEAKING_SCENARIOS §10.1):
 * `Paths.document/recordings/scenario/<runId>/t<turnOrder>-a<attemptNo>.wav|ogg`.
 * The pure name helpers are separated from the expo-file-system handles so
 * the prune planner and the bundle format can be tested in Node.
 */

export const RECORDINGS_ROOT_SEGMENTS = ['recordings', 'scenario'] as const;

export type RecordingExt = 'wav' | 'ogg';

const ATTEMPT_FILE_RE = /^t(\d{2,})-a(\d+)\.(wav|ogg)$/;

/** `t03-a2` — the extension-free stem shared by the WAV and its OGG. */
export function attemptStem(turnOrder: number, attemptNo: number): string {
  return `t${String(Math.max(0, turnOrder)).padStart(2, '0')}-a${Math.max(1, attemptNo)}`;
}

/** `t03-a2.ogg` — the relative name stored in `scenario_attempts.audioFile`. */
export function attemptFileName(turnOrder: number, attemptNo: number, ext: RecordingExt): string {
  return `${attemptStem(turnOrder, attemptNo)}.${ext}`;
}

export interface ParsedAttemptFileName {
  turnOrder: number;
  attemptNo: number;
  ext: RecordingExt;
}

/** Null for anything that is not an attempt recording name (never touched by the queue). */
export function parseAttemptFileName(name: string): ParsedAttemptFileName | null {
  const m = ATTEMPT_FILE_RE.exec(name);
  if (!m) return null;
  return { turnOrder: Number(m[1]), attemptNo: Number(m[2]), ext: m[3] as RecordingExt };
}

/** Swap the extension of an attempt name (`t03-a2.wav` → `t03-a2.ogg`). */
export function withExt(name: string, ext: RecordingExt): string {
  return name.replace(/\.(wav|ogg)$/, `.${ext}`);
}

export function recordingsRoot(): Directory {
  return new Directory(Paths.document, ...RECORDINGS_ROOT_SEGMENTS);
}

export function runDir(runId: string): Directory {
  return new Directory(recordingsRoot(), runId);
}

export function attemptFile(runId: string, name: string): File {
  return new File(runDir(runId), name);
}

/** Sum of the files directly inside a run dir (0 when absent). */
export function runDirBytes(runId: string): number {
  return dirBytes(runDir(runId));
}

export function dirBytes(dir: Directory): number {
  try {
    if (!dir.exists) return 0;
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Run ids that have a directory on disk (whatever the DB says). */
export function listRunDirs(): { runId: string; bytes: number }[] {
  const root = recordingsRoot();
  try {
    if (!root.exists) return [];
    return root
      .list()
      .filter((e): e is Directory => e instanceof Directory)
      .map((d) => ({ runId: d.name, bytes: dirBytes(d) }));
  } catch {
    return [];
  }
}

export function ensureRunDir(runId: string): Directory {
  const dir = runDir(runId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function deleteRunDir(runId: string): boolean {
  const dir = runDir(runId);
  try {
    if (!dir.exists) return false;
    dir.delete();
    return true;
  } catch {
    return false;
  }
}
