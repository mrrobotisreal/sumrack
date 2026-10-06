import { resolveItemAudio, type ExamPart, type ExamSubtest } from '@sumrak/schema';

/**
 * Subtest layout (T71) — PURE. The flat item order of a subtest, and the
 * AUDIO GROUPS of a listening subtest (consecutive items that share one
 * recording: «one dialogue → six questions» is a group of six; «where are
 * they?» items each carry their own audio, so each is a group of one).
 *
 * The audio key of an item = the id of the item that OWNS the audio: its own
 * `audio` ref, else the first item of its part when that one carries it
 * (`resolveItemAudio`, the schema's inheritance rule). Keys are short, stable
 * and survive a kill because `playCounts` (persisted) is keyed by them.
 */

export interface FlatItem {
  id: string;
  partIdx: number;
  itemIdx: number;
  /** Position in the subtest's flat order. */
  flat: number;
  /** Audio owner id, or null when the item plays nothing. */
  audioKey: string | null;
}

export interface ItemGroup {
  /** Flat index of the first / last item (inclusive). */
  start: number;
  end: number;
  audioKey: string | null;
}

export interface SubtestLayout {
  items: FlatItem[];
  groups: ItemGroup[];
  /** item id → flat index. */
  indexOf: Map<string, number>;
  /** flat index → group index. */
  groupOf: number[];
}

/** The audio owner id of `part.items[itemIdx]`, or null. */
export function audioKeyFor(part: Pick<ExamPart, 'items'>, itemIdx: number): string | null {
  const item = part.items[itemIdx];
  if (!item || !resolveItemAudio(part, itemIdx)) return null;
  if ((item.kind === 'choice' || item.kind === 'typed') && item.audio !== undefined) {
    return item.id;
  }
  return part.items[0]?.id ?? null;
}

const cache = new WeakMap<ExamSubtest, SubtestLayout>();

export function buildLayout(subtest: ExamSubtest): SubtestLayout {
  const hit = cache.get(subtest);
  if (hit) return hit;
  const items: FlatItem[] = [];
  subtest.parts.forEach((part, partIdx) => {
    part.items.forEach((item, itemIdx) => {
      items.push({
        id: item.id,
        partIdx,
        itemIdx,
        flat: items.length,
        audioKey: audioKeyFor(part, itemIdx),
      });
    });
  });
  const groups: ItemGroup[] = [];
  const groupOf: number[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && it.audioKey !== null && last.audioKey === it.audioKey) {
      last.end = it.flat;
    } else {
      groups.push({ start: it.flat, end: it.flat, audioKey: it.audioKey });
    }
    groupOf.push(groups.length - 1);
  }
  const layout: SubtestLayout = {
    items,
    groups,
    indexOf: new Map(items.map((i) => [i.id, i.flat])),
    groupOf,
  };
  cache.set(subtest, layout);
  return layout;
}

/** The flat index a cursor `(partIdx, itemIdx)` points at (0 when it points nowhere). */
export function flatIndexOf(layout: SubtestLayout, partIdx: number, itemIdx: number): number {
  const hit = layout.items.find((i) => i.partIdx === partIdx && i.itemIdx === itemIdx);
  return hit ? hit.flat : 0;
}
