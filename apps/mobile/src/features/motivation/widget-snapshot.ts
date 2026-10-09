import { z } from 'zod';

import { WIDGET_SNAPSHOT_VERSION, WIDGET_STALE_MS } from './widget-contract';

/**
 * The widget's whole world (T40): a tiny JSON snapshot the app writes on every
 * daily-activity change and the widget renders with no DB access. PURE — no
 * react-native imports, so vitest can exercise it directly.
 */

const NonNegInt = z.number().int().min(0);

export const WidgetSnapshotSchema = z.strictObject({
  v: z.literal(WIDGET_SNAPSHOT_VERSION),
  streak: NonNegInt,
  dueCount: NonNegInt,
  goal: z.strictObject({
    reviewsDone: NonNegInt,
    reviewsTarget: NonNegInt,
    readingMinDone: NonNegInt,
    readingMinTarget: NonNegInt,
    met: z.boolean(),
    // Reserved for T34's quest registry (not built yet) — always omitted in v1.
    questProgress: z.number().min(0).max(1).optional(),
  }),
  continueReading: z
    .strictObject({ packId: z.string(), storyId: z.string(), title: z.string() })
    .nullable(),
  updatedAtMs: z.number().int(),
});

export type WidgetSnapshot = z.infer<typeof WidgetSnapshotSchema>;

export interface BuildWidgetSnapshotInput {
  streak: number;
  dueCount: number;
  reviewsDone: number;
  /** Today's reading time in milliseconds (floored to whole minutes in the snapshot). */
  readingMs: number;
  goal: { reviews: number; readingMin: number };
  goalMet: boolean;
  continueReading: { packId: string; storyId: string; title: string } | null;
  /** Epoch ms the snapshot is built for (also its `updatedAtMs`). */
  now: number;
}

const nonNeg = (n: number) => Math.max(0, Math.trunc(n));

/** Builds and Zod-validates a snapshot; throws on malformed input (a programming error). */
export function buildWidgetSnapshot(input: BuildWidgetSnapshotInput): WidgetSnapshot {
  return WidgetSnapshotSchema.parse({
    v: WIDGET_SNAPSHOT_VERSION,
    streak: nonNeg(input.streak),
    dueCount: nonNeg(input.dueCount),
    goal: {
      reviewsDone: nonNeg(input.reviewsDone),
      reviewsTarget: nonNeg(input.goal.reviews),
      readingMinDone: nonNeg(Math.floor(input.readingMs / 60_000)),
      readingMinTarget: nonNeg(input.goal.readingMin),
      met: input.goalMet,
    },
    continueReading: input.continueReading,
    updatedAtMs: Math.trunc(input.now),
  });
}

/**
 * 0..1 progress for the ring: the mean of the ENABLED goal parts (a target of 0
 * disables that part), each clamped to 1. With no enabled part (both targets 0)
 * the goal is a yes/no: met → 1, else 0.
 */
export function goalFraction(s: WidgetSnapshot): number {
  const { goal } = s;
  const parts: number[] = [];
  if (goal.reviewsTarget > 0) parts.push(Math.min(1, goal.reviewsDone / goal.reviewsTarget));
  if (goal.readingMinTarget > 0) {
    parts.push(Math.min(1, goal.readingMinDone / goal.readingMinTarget));
  }
  if (parts.length === 0) return goal.met ? 1 : 0;
  return parts.reduce((sum, p) => sum + p, 0) / parts.length;
}

/** True when the snapshot is more than WIDGET_STALE_MS old (strictly: exactly 36 h is fresh). */
export function isStale(s: WidgetSnapshot, now: number): boolean {
  return now - s.updatedAtMs > WIDGET_STALE_MS;
}
