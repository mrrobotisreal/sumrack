/**
 * Backup file naming (T20). Names embed the snapshot moment in UTC so the
 * retention planner can reason about age from the name alone — device-clock
 * and timezone independent (a TZ change or clock jump can never make the
 * planner misjudge an existing file's day). T21's syncd stores identical
 * names.
 */

export const BACKUP_FILE_RE = /^sumrak-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z\.json$/;

export function backupFileName(at: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `sumrak-backup-${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}` +
    `-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z.json`
  );
}

export interface ParsedBackupName {
  name: string;
  /** 'YYYY-MM-DD' (UTC). */
  dateKey: string;
  /** 'YYYY-MM' (UTC). */
  monthKey: string;
  /** Epoch ms of the stamped moment. */
  timestamp: number;
}

/** Null for anything that isn't a well-formed backup name (never pruned). */
export function parseBackupFileName(name: string): ParsedBackupName | null {
  const m = BACKUP_FILE_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const timestamp = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  // Reject impossible calendar values that still match the digit pattern.
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() + 1 !== Number(mo) ||
    check.getUTCDate() !== Number(d) ||
    check.getUTCHours() !== Number(h) ||
    check.getUTCMinutes() !== Number(mi) ||
    check.getUTCSeconds() !== Number(s)
  ) {
    return null;
  }
  return {
    name,
    dateKey: `${y}-${mo}-${d}`,
    monthKey: `${y}-${mo}`,
    timestamp,
  };
}
