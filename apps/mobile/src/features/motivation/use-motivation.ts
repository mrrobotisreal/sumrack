import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { localDateKey } from '@/db/repositories/stats';
import { computeStreak } from '@/lib/streak';

import { parseFreezeState } from './freeze';
import { levelForXp } from './xp';

/**
 * Read model for the motivation UI (T19): streak, freeze wallet, XP/level.
 * Everything the service mutates invalidates ['motivation'], so the Today
 * ring and dashboard stay live as activity accrues.
 */
export function useMotivation() {
  return useQuery({
    queryKey: ['motivation'],
    queryFn: async () => {
      const todayKey = localDateKey();
      const [days, freezeRaw, totalXp, frozen] = await Promise.all([
        repos.stats.getStreakDays(),
        repos.settings.get<unknown>(SETTING_KEYS.streakFreeze),
        repos.stats.getTotalXp(),
        repos.stats.listFrozenDays(1),
      ]);
      const streak = computeStreak(todayKey, days);
      return {
        streak,
        freeze: parseFreezeState(freezeRaw),
        lastFrozenDay: frozen[0] ?? null,
        totalXp,
        level: levelForXp(totalXp),
        goalMetToday: days.met.has(todayKey),
      };
    },
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ['achievements'],
    queryFn: () => repos.stats.listAchievements(),
  });
}
