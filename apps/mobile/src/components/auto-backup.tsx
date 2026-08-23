import { useAutoBackup } from '@/features/backup/use-auto-backup';

/**
 * Renders nothing; mounts the automatic backup triggers (T20): daily on
 * launch/foreground, significant-session on backgrounding. Must sit inside
 * DbProvider — backups read settings and export user tables.
 */
export function AutoBackup() {
  useAutoBackup();
  return null;
}
