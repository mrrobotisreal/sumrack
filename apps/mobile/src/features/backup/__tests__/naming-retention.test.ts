import { describe, expect, it } from 'vitest';

import { backupFileName, parseBackupFileName } from '../naming';
import { planRetention, RETENTION_DAILY_DAYS } from '../retention';

function nameFor(dateKey: string, time = '030000'): string {
  return `sumrak-backup-${dateKey.replaceAll('-', '')}-${time}Z.json`;
}

describe('backup naming', () => {
  it('formats in UTC and round-trips through the parser', () => {
    const at = new Date('2026-08-23T03:07:09Z');
    const name = backupFileName(at);
    expect(name).toBe('sumrak-backup-20260823-030709Z.json');
    const parsed = parseBackupFileName(name);
    expect(parsed).toEqual({
      name,
      dateKey: '2026-08-23',
      monthKey: '2026-08',
      timestamp: at.getTime(),
    });
  });

  it('rejects non-backup names and impossible calendar values', () => {
    expect(parseBackupFileName('manifest.json')).toBeNull();
    expect(parseBackupFileName('sumrak-backup-20260823-030709.json')).toBeNull(); // no Z
    expect(parseBackupFileName(nameFor('2026-13-01'))).toBeNull(); // month 13
    expect(parseBackupFileName(nameFor('2026-02-30'))).toBeNull(); // Feb 30
  });
});

describe('retention ring buffer (30 daily + one per older month)', () => {
  it('keeps everything when fewer than 30 distinct days exist', () => {
    const names = ['2026-08-01', '2026-08-02', '2026-08-03'].map((d) => nameFor(d));
    const plan = planRetention(names);
    expect(plan.prune).toEqual([]);
    expect(plan.keep).toEqual(names);
  });

  it('keeps the newest 30 dates and the latest per older month', () => {
    const names: string[] = [];
    // 40 consecutive days: 2026-07-20 .. 2026-08-28.
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 6, 20 + i));
      names.push(backupFileName(d));
    }
    const plan = planRetention(names);
    const keptDates = plan.keep.map((n) => parseBackupFileName(n)!.dateKey).sort();

    // Newest 30 dates: 2026-07-30 .. 2026-08-28 all kept.
    expect(keptDates.filter((d) => d >= '2026-07-30')).toHaveLength(RETENTION_DAILY_DAYS);
    // Older window 07-20..07-29 collapses to the latest of July in that range.
    const olderKept = keptDates.filter((d) => d < '2026-07-30');
    expect(olderKept).toEqual(['2026-07-29']);
    expect(plan.prune).toHaveLength(9);
    expect(plan.keep.length + plan.prune.length).toBe(names.length);
  });

  it('keeps one monthly per distinct older month', () => {
    const names = [
      // Old months, two snapshots each — the later of each survives.
      nameFor('2026-01-05', '020000'),
      nameFor('2026-01-20', '020000'),
      nameFor('2026-02-03', '020000'),
      nameFor('2026-02-27', '020000'),
      // Recent (well within 30 distinct dates).
      nameFor('2026-08-20'),
      nameFor('2026-08-21'),
      nameFor('2026-08-22'),
    ];
    // 5 distinct recent dates < 30 → the two old months are NOT beyond the
    // window yet... they ARE, because the window is the newest 30 *distinct
    // dates present*, which here covers all 7. Everything stays.
    expect(planRetention(names).prune).toEqual([]);

    // Now add 30 fresh dates so the old months fall outside the window.
    const fresh = Array.from({ length: 30 }, (_, i) =>
      backupFileName(new Date(Date.UTC(2026, 7, 1 + i, 3))),
    );
    const plan = planRetention([...names.slice(0, 4), ...fresh]);
    const olderKept = plan.keep.filter((n) => n < 'sumrak-backup-202608').sort();
    expect(olderKept).toEqual([nameFor('2026-01-20', '020000'), nameFor('2026-02-27', '020000')]);
    expect(plan.prune.sort()).toEqual([
      nameFor('2026-01-05', '020000'),
      nameFor('2026-02-03', '020000'),
    ]);
  });

  it('multiple backups on one recent day are all kept (day granularity)', () => {
    const names = [nameFor('2026-08-23', '010000'), nameFor('2026-08-23', '230000')];
    expect(planRetention(names).prune).toEqual([]);
  });

  it('never touches files it cannot parse, and never prunes the newest backup', () => {
    const stranger = 'README.md';
    const names = [
      stranger,
      ...Array.from({ length: 45 }, (_, i) => backupFileName(new Date(Date.UTC(2026, 3, 1 + i)))),
    ];
    const plan = planRetention(names);
    expect(plan.keep).toContain(stranger);
    const newest = names[names.length - 1]!;
    expect(plan.keep).toContain(newest);
  });

  it('is clock-independent: results derive from names alone', () => {
    // A "future-dated" file (device clock was wrong) is just the newest date;
    // nothing currently needed gets pruned because of it.
    const names = [
      nameFor('2030-01-01'), // wrong-clock artifact
      nameFor('2026-08-22'),
      nameFor('2026-08-23'),
    ];
    expect(planRetention(names).prune).toEqual([]);
  });
});
