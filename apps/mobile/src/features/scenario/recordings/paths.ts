import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where attempt recordings live (T63, SPEAKING_SCENARIOS §10.1):
 * `Paths.document/recordings/scenario/<runId>/t<turnOrder>-a<attemptNo>.wav|ogg`.
 * The pure name helpers are separated from the expo-file-system handles so
 * the prune planner and the bundle format can be tested in Node.
 *
 * T73 (TORFL §8.5): every handle takes an optional ROOT, `'scenario'`
 * (default — every M17 call site is unchanged) or `'exam'`, whose
 * directories are exam attempts: `recordings/exam/<attemptId>/
 * t<task>-<itemId>.wav|ogg`.
 */

export type RecordingsRoot = 'scenario' | 'exam';

export const RECORDINGS_ROOT_SEGMENTS = ['recordings', 'scenario'] as const;
export const EXAM_RECORDINGS_ROOT_SEGMENTS = ['recordings', 'exam'] as const;

export function rootSegments(root: RecordingsRoot): readonly string[] {
  return root === 'exam' ? EXAM_RECORDINGS_ROOT_SEGMENTS : RECORDINGS_ROOT_SEGMENTS;
}

export type RecordingExt = 'wav' | 'ogg';

const ATTEMPT_FILE_RE = /^t(\d{2,})-a(\d+)\.(wav|ogg)$/;
const EXAM_FILE_RE = /^t([123])-([A-Za-z0-9_.~-]+)\.(wav|ogg)$/;

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

/** `t1-sp01.wav` — an exam speaking answer (T73): the task number + the item id. */
export function examRecordingName(task: 1 | 2 | 3, itemId: string, ext: RecordingExt): string {
  return `t${task}-${itemId}.${ext}`;
}

export interface ParsedExamRecordingName {
  task: 1 | 2 | 3;
  itemId: string;
  ext: RecordingExt;
}

export function parseExamRecordingName(name: string): ParsedExamRecordingName | null {
  const m = EXAM_FILE_RE.exec(name);
  if (!m) return null;
  return { task: Number(m[1]) as 1 | 2 | 3, itemId: m[2]!, ext: m[3] as RecordingExt };
}

/** Swap the extension of an attempt name (`t03-a2.wav` → `t03-a2.ogg`). */
export function withExt(name: string, ext: RecordingExt): string {
  return name.replace(/\.(wav|ogg)$/, `.${ext}`);
}

export function recordingsRoot(root: RecordingsRoot = 'scenario'): Directory {
  return new Directory(Paths.document, ...rootSegments(root));
}

export function runDir(runId: string, root: RecordingsRoot = 'scenario'): Directory {
  return new Directory(recordingsRoot(root), runId);
}

export function attemptFile(runId: string, name: string, root: RecordingsRoot = 'scenario'): File {
  return new File(runDir(runId, root), name);
}

/** Sum of the files directly inside a run dir (0 when absent). */
export function runDirBytes(runId: string, root: RecordingsRoot = 'scenario'): number {
  return dirBytes(runDir(runId, root));
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

/** Run (or exam attempt) ids that have a directory on disk (whatever the DB says). */
export function listRunDirs(root: RecordingsRoot = 'scenario'): { runId: string; bytes: number }[] {
  const dir = recordingsRoot(root);
  try {
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is Directory => e instanceof Directory)
      .map((d) => ({ runId: d.name, bytes: dirBytes(d) }));
  } catch {
    return [];
  }
}

export function ensureRunDir(runId: string, root: RecordingsRoot = 'scenario'): Directory {
  const dir = runDir(runId, root);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function deleteRunDir(runId: string, root: RecordingsRoot = 'scenario'): boolean {
  const dir = runDir(runId, root);
  try {
    if (!dir.exists) return false;
    dir.delete();
    return true;
  } catch {
    return false;
  }
}

/** File names directly inside a run dir (empty when absent). */
export function listRunFiles(runId: string, root: RecordingsRoot = 'scenario'): string[] {
  try {
    const dir = runDir(runId, root);
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => f.name);
  } catch {
    return [];
  }
}
