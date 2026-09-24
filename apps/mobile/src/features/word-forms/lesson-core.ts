import { z } from 'zod';

import type { GrammarLessonRow } from '@/db/repositories/word-forms';
import { parseStoredAssessment } from '@/features/ai/schemas';

/**
 * Pure grammar-lesson helpers (M16/T54, WORD_FORMS §6.2 + §7.3): the
 * response contract, the learner-level rule, and the day grouping the
 * global Lessons screen renders. Unit-tested under Node; nothing here
 * touches the DB or the network.
 */

/** §6.2: bounded markdown — anything else ⇒ `invalid-response`, no automatic retry. */
export const GrammarLessonSchema = z.string().min(200).max(30_000);

/** The six §6.2 headings, in order (the lesson test asserts every one is present). */
export const LESSON_HEADINGS = [
  'What this is and why it matters for',
  'The pattern',
  'The forms',
  'In the wild',
  'Watch out',
  'Check yourself',
] as const;

/**
 * Raw model answer → the lesson markdown (trimmed, NFC), or null when it
 * is outside the §6.2 bounds. Code fences around the whole lesson are
 * stripped (some models wrap markdown in ```markdown … ```).
 */
export function parseLessonAnswer(content: string): string | null {
  let text = content.trim().normalize('NFC');
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1]!.trim();
  const parsed = GrammarLessonSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** Headings of a lesson (`## …` lines), without the marker — for the fixture test and a11y. */
export function lessonHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((h): h is string => !!h);
}

/** True when the markdown carries at least one pipe table (a header row + `---` divider). */
export function hasMarkdownTable(markdown: string): boolean {
  const lines = markdown.split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]!) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) return true;
  }
  return false;
}

/** Sentences (lines) that contain Cyrillic and at least one combining acute U+0301. */
export function countStressedSentences(markdown: string): number {
  return markdown.split('\n').filter((line) => /[Ѐ-ӿ]/.test(line) && line.includes('́')).length;
}

// --- learner level (§6.2) -----------------------------------------------------

/** The default when no assessment is stored yet. */
export const DEFAULT_LEARNER_LEVEL = 'A1';

/**
 * Pure part of `getLearnerLevel()`: the newest readable assessment's
 * `skills.reading.level`, else `A1`. Rows come newest-first from
 * `listAssessments`; unreadable payloads are skipped, not treated as A1.
 */
export function learnerLevelFrom(rows: readonly { payload: unknown; createdAt: number }[]): string {
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  for (const row of sorted) {
    const parsed = parseStoredAssessment(row.payload);
    if (parsed) return parsed.skills.reading.level;
  }
  return DEFAULT_LEARNER_LEVEL;
}

// --- day grouping (§7.3 global screen) ------------------------------------------

export interface DayGroup<T> {
  /** Local calendar day key `YYYY-MM-DD`. */
  day: string;
  /** «Today» · «Yesterday» · «24 Sep 2026». */
  label: string;
  rows: T[];
}

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Local-time day key (the user's calendar day, like the T19 streak logic). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

/** «Today» / «Yesterday» relative to `now`, else the table-driven `d MMM yyyy` (Hermes-safe like ru-date's fallback). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const key = dayKey(ms);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 86_400_000)) return 'Yesterday';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Group rows (already newest first) by local calendar day, preserving
 * order — the global Lessons screen's section list.
 */
export function groupByDay<T extends { createdAt: number }>(
  rows: readonly T[],
  now: number = Date.now(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const day = dayKey(row.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, label: dayLabel(row.createdAt, now), rows: [row] });
  }
  return groups;
}

// --- section grouping (§7.3 item Lessons tab) -----------------------------------

export interface SectionGroup {
  sectionId: string;
  rows: GrammarLessonRow[];
}

/**
 * Group one word's lessons by section, sections ordered by `rank` (catalog
 * order — the caller passes `sectionRank`), rows kept newest first.
 */
export function groupBySection(
  rows: readonly GrammarLessonRow[],
  rank: (sectionId: string) => number,
): SectionGroup[] {
  const byId = new Map<string, GrammarLessonRow[]>();
  for (const row of rows) {
    const list = byId.get(row.sectionId);
    if (list) list.push(row);
    else byId.set(row.sectionId, [row]);
  }
  return [...byId.entries()]
    .map(([sectionId, list]) => ({
      sectionId,
      rows: [...list].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)),
    }))
    .sort(
      (a, b) => rank(a.sectionId) - rank(b.sectionId) || a.sectionId.localeCompare(b.sectionId),
    );
}
