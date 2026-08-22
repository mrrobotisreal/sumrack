import { z } from 'zod';

/**
 * Pure prompt-rotation logic (T15) — split from the hook file so it can be
 * unit-tested in Node (the hook layer imports repos → native SQLite).
 */

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type Cefr = (typeof CEFR)[number];

/** Prompt rows leaving the DB are re-validated at this I/O boundary (roadmap §3). */
export const PromptRowSchema = z.object({
  packId: z.string().min(1),
  id: z.string().min(1),
  level: z.enum(CEFR),
  promptRu: z.string().min(1),
  promptEn: z.string().min(1),
  tags: z.array(z.string()).nullable(),
});
export type PromptRow = z.infer<typeof PromptRowSchema>;

/**
 * T17 owns the real path-position shape; until then accept any object
 * carrying a CEFR `level` and fall back to A1 (Mitch's current level —
 * ticket: "sane default if no path state exists yet").
 */
export const PathPositionSchema = z.object({ level: z.enum(CEFR) }).loose();

export const DEFAULT_LEVEL: Cefr = 'A1';

/** Stable per-local-day number — +1 every calendar day, drives rotation. */
export function localDayKey(now = new Date()): number {
  return now.getFullYear() * 372 + now.getMonth() * 31 + (now.getDate() - 1);
}

/**
 * Pick the prompt of the day. Candidates: exact-level prompts first; if the
 * level has none, everything at or below it; if still none, all prompts.
 * Stable (packId, id) ordering + day rotation; `skip` advances within the
 * same day.
 */
export function selectDailyPrompt(
  prompts: PromptRow[],
  level: Cefr,
  dayKey: number,
  skip: number,
): PromptRow | null {
  if (prompts.length === 0) return null;
  const maxIdx = CEFR.indexOf(level);
  let candidates = prompts.filter((p) => p.level === level);
  if (candidates.length === 0) {
    candidates = prompts.filter((p) => CEFR.indexOf(p.level) <= maxIdx);
  }
  if (candidates.length === 0) candidates = prompts;
  const ordered = [...candidates].sort((a, b) =>
    `${a.packId}/${a.id}`.localeCompare(`${b.packId}/${b.id}`),
  );
  return ordered[(((dayKey + skip) % ordered.length) + ordered.length) % ordered.length]!;
}
