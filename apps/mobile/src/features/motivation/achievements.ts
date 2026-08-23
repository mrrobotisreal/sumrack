import type { Ionicons } from '@expo/vector-icons';

/**
 * The achievement set (T19, §7.7 named minimum + a few natural milestones
 * already implied by shipped features). Ids are stable strings persisted in
 * the `achievements` table — never rename one that may have unlocked.
 * Unlock checks are evented off existing write paths (ticket requirement),
 * see service.ts; `stats.unlockAchievement` is idempotent so a re-fired
 * check can never double-unlock or re-toast.
 */
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-word',
    title: 'Первое слово',
    description: 'Add your first word to the word bank',
    icon: 'bookmark-outline',
  },
  {
    id: 'first-story',
    title: 'Первая история',
    description: 'Finish reading your first story',
    icon: 'book-outline',
  },
  {
    id: 'first-journal',
    title: 'Дорогой дневник',
    description: 'Write your first journal entry',
    icon: 'create-outline',
  },
  {
    id: 'bank-100',
    title: 'Коллекционер',
    description: 'Grow the word bank to 100 items',
    icon: 'library-outline',
  },
  {
    id: 'mastered-100',
    title: 'Сто слов в темноте',
    description: 'Master 100 lemmas (mature FSRS stability)',
    icon: 'school-outline',
  },
  {
    id: 'streak-7',
    title: 'Неделя во тьме',
    description: 'Keep a 7-day goal streak',
    icon: 'flame-outline',
  },
  {
    id: 'streak-30',
    title: 'Месяц в сумраке',
    description: 'Keep a 30-day goal streak',
    icon: 'flame',
  },
  {
    id: 'streak-100',
    title: 'Сто ночей',
    description: 'Keep a 100-day goal streak',
    icon: 'bonfire-outline',
  },
  {
    id: 'first-checkpoint',
    title: 'Контрольная пройдена',
    description: 'Pass your first level checkpoint',
    icon: 'flag-outline',
  },
  {
    id: 'first-unit',
    title: 'Первый шаг пути',
    description: 'Complete your first course unit',
    icon: 'trail-sign-outline',
  },
  {
    id: 'pron-perfect',
    title: 'Чистое произношение',
    description: 'Score a perfect 100 in pronunciation practice',
    icon: 'mic-outline',
  },
  {
    id: 'level-5',
    title: 'Пятый уровень',
    description: 'Reach XP level 5',
    icon: 'trending-up-outline',
  },
  {
    id: 'level-10',
    title: 'Десятый уровень',
    description: 'Reach XP level 10',
    icon: 'rocket-outline',
  },
];

export const ACHIEVEMENTS_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Streak achievements in ascending threshold order. */
export const STREAK_ACHIEVEMENTS: { id: string; days: number }[] = [
  { id: 'streak-7', days: 7 },
  { id: 'streak-30', days: 30 },
  { id: 'streak-100', days: 100 },
];

export const LEVEL_ACHIEVEMENTS: { id: string; level: number }[] = [
  { id: 'level-5', level: 5 },
  { id: 'level-10', level: 10 },
];

/** T18's "mature" band boundary — the mastery bar for mastered-100. */
export const MASTERED_STABILITY_DAYS = 30;
export const MASTERED_TARGET = 100;
export const BANK_TARGET = 100;
