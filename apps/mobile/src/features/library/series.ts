/**
 * T86: series grouping for the Library (THREE_BODY_SERIES.md §1–§2). PURE — no
 * DB, no React. A pack carrying `series:<slug>` + `book:<B>` + `chapter:<N>`
 * collapses into one book row per (series, book); a malformed or partial set
 * of those tags leaves the pack untagged (rendered exactly as before).
 */

const SERIES_TAG = /^series:([a-z0-9][a-z0-9-]*)$/;
const BOOK_TAG = /^book:([1-9][0-9]*)$/;
const CHAPTER_TAG = /^chapter:([1-9][0-9]*)$/;

export interface SeriesPlacement {
  series: string;
  book: number;
  chapter: number;
}

/** All three tags required; any malformed or missing one → null. */
export function parseSeriesTags(tags: readonly string[]): SeriesPlacement | null {
  let series: string | null = null;
  let book: number | null = null;
  let chapter: number | null = null;
  for (const tag of tags) {
    const s = SERIES_TAG.exec(tag);
    if (s?.[1]) series = s[1];
    const b = BOOK_TAG.exec(tag);
    if (b?.[1]) book = Number(b[1]);
    const c = CHAPTER_TAG.exec(tag);
    if (c?.[1]) chapter = Number(c[1]);
  }
  if (series === null || book === null || chapter === null) return null;
  return { series, book, chapter };
}

export interface SeriesBookInfo {
  title: string;
  subtitle?: string;
}

/** App-owned book titles (packs carry only `book:<B>`). */
export const SERIES_REGISTRY: Readonly<Record<string, Readonly<Record<number, SeriesBookInfo>>>> = {
  'three-body': {
    1: { title: 'Задача трёх тел 1', subtitle: 'Безмолвная весна' },
    2: { title: 'Задача трёх тел 2', subtitle: 'Три тела' },
    3: { title: 'Задача трёх тел 3' },
  },
};

const RU_DASH = ' — ';

/**
 * Book heading (title + optional subtitle). Registry hit → registry title + subtitle. Otherwise the first
 * member's title before « — » with any trailing number stripped, plus ` <B>`
 * (the literal design form would render «Задача трёх тел 2 2»).
 */
export function seriesBookTitle(
  series: string,
  book: number,
  fallbackTitleRu: string,
): SeriesBookInfo {
  const hit = SERIES_REGISTRY[series]?.[book];
  if (hit) return hit;
  const head = fallbackTitleRu.split(RU_DASH)[0] ?? fallbackTitleRu;
  const stem = head.replace(/\s*\d+\s*$/, '').trim() || head.trim();
  return { title: `${stem} ${book}` };
}

/** Chapter row label: the part after « — »; no « — » → the full title. */
export function chapterLabel(titleRu: string): string {
  const idx = titleRu.indexOf(RU_DASH);
  return idx === -1 ? titleRu : titleRu.slice(idx + RU_DASH.length).trim();
}

export interface SeriesChapter<T> {
  chapter: number;
  item: T;
}

export type SeriesGroupResult<T> =
  | { kind: 'plain'; item: T }
  | { kind: 'book'; series: string; book: number; chapters: SeriesChapter<T>[] };

/**
 * Collapse a positioned item list into series books. A book takes the list
 * position of its FIRST member; books order by number, chapters by number.
 * A duplicate (series, book, chapter) keeps the first item and drops the rest.
 * A one-chapter book still renders as a book (the series is the point).
 */
export function groupBySeries<T>(
  items: readonly T[],
  getTags: (item: T) => readonly string[],
): SeriesGroupResult<T>[] {
  const placements = items.map((item) => parseSeriesTags(getTags(item)));
  const books = new Map<string, Map<number, SeriesChapter<T>[]>>();
  items.forEach((item, i) => {
    const p = placements[i];
    if (!p) return;
    const byBook = books.get(p.series) ?? new Map<number, SeriesChapter<T>[]>();
    books.set(p.series, byBook);
    const chapters = byBook.get(p.book) ?? [];
    if (!chapters.some((c) => c.chapter === p.chapter)) {
      chapters.push({ chapter: p.chapter, item });
    }
    byBook.set(p.book, chapters);
  });

  // Book slots sit at their first member's list position; the books that
  // occupy those slots are ordered by number (the design's «books by number»).
  const slots: { index: number; series: string; book: number }[] = [];
  const seen = new Set<string>();
  placements.forEach((p, index) => {
    if (!p) return;
    const id = `${p.series}\u0000${p.book}`;
    if (seen.has(id)) return;
    seen.add(id);
    slots.push({ index, series: p.series, book: p.book });
  });
  const byNumber = [...slots].sort((a, b) =>
    a.series === b.series ? a.book - b.book : a.series.localeCompare(b.series),
  );
  const bookAt = new Map<number, SeriesGroupResult<T>>();
  slots.forEach((slot, n) => {
    const book = byNumber[n]!;
    const chapters = [...(books.get(book.series)?.get(book.book) ?? [])].sort(
      (a, b) => a.chapter - b.chapter,
    );
    bookAt.set(slot.index, { kind: 'book', series: book.series, book: book.book, chapters });
  });

  const result: SeriesGroupResult<T>[] = [];
  items.forEach((item, index) => {
    const placed = bookAt.get(index);
    if (placed) result.push(placed);
    else if (!placements[index]) result.push({ kind: 'plain', item });
  });
  return result;
}
