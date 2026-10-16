/**
 * T84: «Continue reading» = continue what Mitch LAST READ — the one rule the
 * home-screen widget and Today's card share. PURE (no DB, no React).
 *
 * The T40 rule picked the newest UNFINISHED row, so finishing a part made the
 * target fall back to some old unfinished story (his one news article) — and
 * opening that story bumped its `updatedAt`, so it won forever. Now:
 *
 * 1. Take the most recently read story (newest `updatedAt`, finished or not).
 * 2. Unfinished → resume it at its saved position.
 * 3. Finished → the next story of the same pack by `orderIdx` (resuming its
 *    saved position if it was started and not finished).
 * 4. Finished and the last of its pack (or the next one is already finished)
 *    → the newest unfinished story anywhere; none → null (open the Library).
 *
 * T86 series step (between 3 and 4): finished and the LAST part of its pack,
 * the pack belongs to a series → the first part of the same series' next
 * chapter (chapter + 1) at the SAME level, if that part is unfinished →
 * `next`. A different-level or missing chapter falls through to rule 4.
 */

export interface ContinueProgress {
  packId: string;
  storyId: string;
  updatedAt: number;
  finishedAt: number | null;
}

export interface ContinueStory {
  packId: string;
  id: string;
  orderIdx: number;
  titleRu: string;
}

export type ContinueKind = 'resume' | 'next' | 'fallback';

export interface ContinueTarget {
  packId: string;
  storyId: string;
  title: string;
  kind: ContinueKind;
  /** T86: set on a `next` step that crossed into another chapter (the pack it came from). */
  fromPackId?: string;
}

const key = (packId: string, storyId: string) => `${packId}\u0000${storyId}`;

/** T86: the series placement of a pack, or null when it is not a series pack. */
export interface SeriesPlacementOf {
  series: string;
  chapter: number;
  level: string;
}

export function resolveContinueTarget(
  progress: readonly ContinueProgress[],
  stories: readonly ContinueStory[],
  seriesOf?: (packId: string) => SeriesPlacementOf | null,
): ContinueTarget | null {
  const storyByKey = new Map(stories.map((s) => [key(s.packId, s.id), s]));
  const progressByKey = new Map(progress.map((p) => [key(p.packId, p.storyId), p]));
  // Rows whose story was removed with its pack are invisible to every rule.
  const live = progress
    .filter((p) => storyByKey.has(key(p.packId, p.storyId)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const last = live[0];
  if (!last) return null;

  const lastStory = storyByKey.get(key(last.packId, last.storyId))!;
  if (last.finishedAt == null) {
    return { packId: last.packId, storyId: last.storyId, title: lastStory.titleRu, kind: 'resume' };
  }

  const next = stories
    .filter((s) => s.packId === last.packId && s.orderIdx > lastStory.orderIdx)
    .sort((a, b) => a.orderIdx - b.orderIdx)[0];
  if (next && progressByKey.get(key(next.packId, next.id))?.finishedAt == null) {
    return { packId: next.packId, storyId: next.id, title: next.titleRu, kind: 'next' };
  }

  // Series step only when the last-read story is the LAST part of its pack.
  const series = !next && seriesOf ? seriesOf(last.packId) : null;
  if (series && seriesOf) {
    const nextChapter = firstPartOfNextChapter(stories, seriesOf, series, progressByKey);
    if (nextChapter) {
      return {
        packId: nextChapter.packId,
        storyId: nextChapter.id,
        title: nextChapter.titleRu,
        kind: 'next',
        fromPackId: last.packId,
      };
    }
  }

  const unfinished = live.find((p) => p.finishedAt == null);
  if (!unfinished) return null;
  const s = storyByKey.get(key(unfinished.packId, unfinished.storyId))!;
  return {
    packId: unfinished.packId,
    storyId: unfinished.storyId,
    title: s.titleRu,
    kind: 'fallback',
  };
}

/**
 * T86 series step: the lowest-orderIdx part of an installed pack with the same
 * series, the same level and chapter + 1, when that part is unfinished.
 */
function firstPartOfNextChapter(
  stories: readonly ContinueStory[],
  seriesOf: (packId: string) => SeriesPlacementOf | null,
  from: SeriesPlacementOf,
  progressByKey: ReadonlyMap<string, ContinueProgress>,
): ContinueStory | null {
  const candidates = stories.filter((s) => {
    const p = seriesOf(s.packId);
    return (
      p !== null &&
      p.series === from.series &&
      p.level === from.level &&
      p.chapter === from.chapter + 1
    );
  });
  const first = candidates.sort((a, b) => a.orderIdx - b.orderIdx)[0];
  if (!first) return null;
  return progressByKey.get(key(first.packId, first.id))?.finishedAt == null ? first : null;
}
