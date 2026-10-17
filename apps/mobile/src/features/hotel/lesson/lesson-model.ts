import type { CourseCard, CourseItem, CourseUnit } from '@sumrak/schema';

/**
 * Pure lesson rules (T90, HOTEL_PATH D7 + decision 1). No DB, no React:
 * the highlight matcher for example sentences, the card → topic jump, the
 * lesson position (where a learner resumes), and the card pager's bounds.
 */

/** Lower-case, fold ё → е (the highlight match is ё/е tolerant). */
export function foldRu(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

/** A token of a sentence as the matcher reads it (`text` = the surface). */
export interface MatchToken {
  text: string;
  isPunct?: boolean;
}

/**
 * Which token index each highlight surface colours. A highlight entry
 * matches the FIRST not-yet-used token whose folded text equals its folded
 * surface; every entry is used at most once. Entries with no match are
 * skipped (a typo never crashes the card).
 */
export function highlightIndices(
  tokens: readonly MatchToken[],
  highlight: readonly string[],
): Set<number> {
  const out = new Set<number>();
  for (const surface of highlight) {
    const want = foldRu(surface);
    const idx = tokens.findIndex((t, i) => !t.isPunct && !out.has(i) && foldRu(t.text) === want);
    if (idx >= 0) out.add(idx);
  }
  return out;
}

/** The first explain card whose examples' `why`, or whose title, names the topic label; else the first explain card; else null. */
export function cardForTopic(
  cards: readonly CourseCard[],
  topicLabel: string,
): { cardIndex: number; card: CourseCard } | null {
  const needle = foldRu(topicLabel.trim());
  const explains = cards
    .map((card, cardIndex) => ({ card, cardIndex }))
    .filter(
      (c): c is { card: Extract<CourseCard, { kind: 'explain' }>; cardIndex: number } =>
        c.card.kind === 'explain',
    );
  if (explains.length === 0) return null;
  const hit = needle
    ? explains.find(
        ({ card }) =>
          foldRu(card.title.ru).includes(needle) ||
          foldRu(card.title.en).includes(needle) ||
          card.examples.some((ex) => ex.why !== undefined && foldRu(ex.why).includes(needle)),
      )
    : undefined;
  return hit ?? explains[0] ?? null;
}

/** The topic label used by `cardForTopic`: the item's topic slug with dashes as spaces. */
export function topicLabel(item: Pick<CourseItem, 'topic'>): string {
  return item.topic.replace(/-/g, ' ');
}

/** `hotel.lessonPos` — `{ [packId:unitId]: cardIndex }`. Parsed defensively. */
export type LessonPositions = Record<string, number>;

export function parseLessonPositions(raw: unknown): LessonPositions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: LessonPositions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) out[key] = value;
  }
  return out;
}

export function lessonKey(packId: string, unitId: string): string {
  return `${packId}:${unitId}`;
}

/** The card index to resume at, clamped into the unit (a pack update may shorten it). */
export function resumeIndex(
  positions: LessonPositions,
  packId: string,
  unit: Pick<CourseUnit, 'id' | 'cards'>,
): number {
  const saved = positions[lessonKey(packId, unit.id)];
  if (saved === undefined) return 0;
  return Math.min(Math.max(0, saved), Math.max(0, unit.cards.length - 1));
}

/** The position after moving the pager: never below 0, never past the last card. */
export function clampCard(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, index), count - 1);
}

/** Progress bar fraction for card `index` of `count` (1-based for the label, 0..1 for the bar). */
export function cardProgress(index: number, count: number): number {
  if (count <= 0) return 0;
  return (clampCard(index, count) + 1) / count;
}

/** The sentence refs a unit's lesson will voice, in order (for prefetch and the tests). */
export function lessonSentenceRefs(
  unit: Pick<CourseUnit, 'cards'>,
): { storyId: string; sentenceId: string }[] {
  const out: { storyId: string; sentenceId: string }[] = [];
  for (const card of unit.cards) {
    if (card.kind === 'explain' || card.kind === 'edge') {
      for (const ex of card.examples) out.push(ex.sentenceRef);
    } else if (card.kind === 'traps') {
      for (const pair of card.pairs) out.push(pair.right);
    }
  }
  return out;
}

/** One visual chunk of a sentence: a word with its trailing/leading punctuation attached. */
export interface SentenceChunk {
  /** The chunk's text as shown. */
  text: string;
  /** Index of the word token inside the sentence (-1 when the chunk is punctuation only). */
  wordIndex: number;
  /** Every token index the chunk covers (punctuation joins its word; karaoke lights them together). */
  tokenIndices: number[];
}

/**
 * Group tokens into chunks the way the reader does (punctuation glues to the
 * word before it, so a karaoke wash never splits «городе.»). Pure.
 */
export function buildSentenceChunks(
  tokens: readonly (MatchToken & { isPunct?: boolean })[],
): SentenceChunk[] {
  const chunks: SentenceChunk[] = [];
  tokens.forEach((t, i) => {
    const last = chunks[chunks.length - 1];
    if (t.isPunct && last) {
      last.text += t.text;
      last.tokenIndices.push(i);
      return;
    }
    chunks.push({ text: t.text, wordIndex: t.isPunct ? -1 : i, tokenIndices: [i] });
  });
  return chunks;
}

/** A sentence ref as a map key: `storyId/sentenceId`. */
export type SentenceRefKey = `${string}/${string}`;
