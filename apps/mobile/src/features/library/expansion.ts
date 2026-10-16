import { z } from 'zod';

/**
 * T86: Library accordion expansion keys + pure helpers (THREE_BODY_SERIES.md
 * §2 rule 4). PURE — the zustand store in store/library-expansion.ts owns the
 * persistence. Keys are ordered by toggle time (newest last) so the cap of
 * MAX_KEYS keeps the most recently touched sections.
 */

export const MAX_EXPANSION_KEYS = 500;

export const packKey = (packId: string) => `pack:${packId}`;
export const familyKey = (slug: string) => `family:${slug}`;
export const bookKey = (series: string, book: number) => `series:${series}:book:${book}`;
export const chapterKey = (series: string, chapter: number) =>
  `series:${series}:chapter:${chapter}`;

export const ExpansionSchema = z.object({
  v: z.literal(1),
  keys: z.array(z.string()),
});

/** Stored shape → keys. Malformed (wrong shape, non-array) → []. Keeps the newest 500. */
export function sanitizeExpansion(raw: unknown): string[] {
  const parsed = ExpansionSchema.safeParse(raw);
  if (!parsed.success) return [];
  return capKeys(parsed.data.keys);
}

function capKeys(keys: string[]): string[] {
  return keys.length > MAX_EXPANSION_KEYS ? keys.slice(-MAX_EXPANSION_KEYS) : keys;
}

/** Remove any existing copy, then append (newest last) when expanding, then cap. */
export function toggleKey(keys: readonly string[], key: string, expanded: boolean): string[] {
  const rest = keys.filter((k) => k !== key);
  return capKeys(expanded ? [...rest, key] : rest);
}

/** Collapsed → no rows (SectionList must not render a collapsed section's rows). */
export function sectionDataFor<R>(
  sectionKey: string,
  rows: R[],
  expanded: ReadonlySet<string>,
): R[] {
  return expanded.has(sectionKey) ? rows : [];
}

/** Finished / total for a list of stories — the collapsed-row progress summary. */
export function summarizeStories(stories: readonly { finished: boolean }[]): {
  finished: number;
  total: number;
} {
  let finished = 0;
  for (const story of stories) if (story.finished) finished += 1;
  return { finished, total: stories.length };
}
