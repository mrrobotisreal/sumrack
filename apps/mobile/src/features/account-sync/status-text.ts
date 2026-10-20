import type { SyncErrorInfo, SyncStatus } from './store';

/** Russian status line + English caption (pure; the Settings rows render it). */
export function statusLines(s: {
  status: SyncStatus;
  pending: number;
  lastSyncAt: number | null;
  lastError: SyncErrorInfo | null;
  linked: boolean;
  now: number;
}): { ru: string; en: string; tone: 'ok' | 'warn' | 'error' | 'muted' } {
  if (!s.linked) {
    return {
      ru: 'Синхронизация не включена',
      en: 'Sync is not linked on this phone yet',
      tone: 'muted',
    };
  }
  if (s.status === 'syncing') return { ru: 'Синхронизация…', en: 'Syncing', tone: 'muted' };
  if (s.status === 'error') {
    return {
      ru: 'Не удалось синхронизировать',
      en: s.lastError?.message ?? 'Sync failed',
      tone: 'error',
    };
  }
  if (s.status === 'offline') {
    return {
      ru: 'Нет сети — сохранено на телефоне',
      en: 'Offline — saved on this phone',
      tone: 'warn',
    };
  }
  if (s.pending > 0) {
    return {
      ru: `Ожидает: ${s.pending} ${changesWord(s.pending)}`,
      en: `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync`,
      tone: 'warn',
    };
  }
  if (s.lastSyncAt == null)
    return { ru: 'Ещё не синхронизировано', en: 'Not synced yet', tone: 'muted' };
  return {
    ru: `Синхронизировано · ${agoRu(s.now - s.lastSyncAt)}`,
    en: 'Everything is up to date',
    tone: 'ok',
  };
}

export function changesWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'изменение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'изменения';
  return 'изменений';
}

export function agoRu(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return 'только что';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}
