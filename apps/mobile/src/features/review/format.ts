import { Rating, State } from 'ts-fsrs';

import type { CardDirection } from '@/db/schema';

/** Display helpers for FSRS state — card detail + session UI share these. */

export const DIRECTION_LABELS: Record<CardDirection, string> = {
  'ru-en': 'RU → EN',
  'en-ru': 'EN → RU',
  listening: 'Listening',
  production: 'Production',
};

export function stateName(state: number): string {
  switch (state) {
    case State.New:
      return 'New';
    case State.Learning:
      return 'Learning';
    case State.Review:
      return 'Review';
    case State.Relearning:
      return 'Relearning';
    default:
      return `State ${state}`;
  }
}

export function ratingName(rating: number): string {
  switch (rating) {
    case Rating.Again:
      return 'Again';
    case Rating.Hard:
      return 'Hard';
    case Rating.Good:
      return 'Good';
    case Rating.Easy:
      return 'Easy';
    default:
      return `Rating ${rating}`;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/** "due now" / "in 10m" / "in 3d" — coarse on purpose, FSRS times aren't promises. */
export function formatDue(dueAt: number, now: number = Date.now()): string {
  const delta = dueAt - now;
  if (delta <= 0) return 'due now';
  if (delta < HOUR) return `in ${Math.max(1, Math.round(delta / MINUTE))}m`;
  if (delta < DAY) return `in ${Math.round(delta / HOUR)}h`;
  if (delta < MONTH * 2) return `in ${Math.round(delta / DAY)}d`;
  return `in ${Math.round(delta / MONTH)}mo`;
}
