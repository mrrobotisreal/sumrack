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

/** The minimal section shape the ancestor lookup needs (LibrarySection satisfies it). */
export interface AncestorSection {
  /** Every pack this section can show — a family shelf lists all its rungs. */
  packIds: readonly string[];
  family?: { slug: string };
  book?: { series: string; book: number; chapters: { chapter: number; section: AncestorSection }[] };
}

/**
 * Keys of every section that must be open to show `packId`: its series book
 * and chapter (when it sits in one), then its family or pack key. Empty when
 * the pack is not on screen.
 */
export function ancestorKeysFor(sections: readonly AncestorSection[], packId: string): string[] {
  for (const section of sections) {
    if (section.book) {
      for (const chapter of section.book.chapters) {
        const inner = ancestorKeysFor([chapter.section], packId);
        if (inner.length > 0) {
          return [
            bookKey(section.book.series, section.book.book),
            chapterKey(section.book.series, chapter.chapter),
            ...inner,
          ];
        }
      }
      continue;
    }
    if (section.packIds.includes(packId)) {
      return [section.family ? familyKey(section.family.slug) : packKey(section.packIds[0]!)];
    }
  }
  return [];
}
