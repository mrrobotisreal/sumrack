import type { ListenAvailability } from '@/db/repositories/listen';

export interface ListenRowItem {
  kind: 'listen';
  packId: string;
  availability: ListenAvailability;
}

/**
 * Prepend the «Прослушать всю историю» row to a `stories` pack's rows when
 * its availability is not `none` (T97 decision 1). Other pack types untouched.
 */
export function withListenRow<R extends { kind: string }>(
  rows: R[],
  pack: { id: string; type: string },
  availability: Map<string, ListenAvailability> | undefined,
): (R | ListenRowItem)[] {
  if (pack.type !== 'stories') return rows;
  const a = availability?.get(pack.id);
  if (!a || a.state === 'none') return rows;
  return [{ kind: 'listen', packId: pack.id, availability: a }, ...rows];
}

/** orderRows' tail: listen row first, then ordered stories, then the rest. */
export function assembleRows<R extends { kind: string }>(rows: R[], orderedStories: R[]): R[] {
  return [
    ...rows.filter((r) => r.kind === 'listen'),
    ...orderedStories,
    ...rows.filter((r) => r.kind !== 'story' && r.kind !== 'listen'),
  ];
}

/** The right-hand state of the row: nothing · NN % · finished · now playing. */
export function listenRowTrailing(args: {
  nowPlaying: boolean;
  finished: boolean;
  progressPercent: number | null;
}): { kind: 'none' } | { kind: 'playing' } | { kind: 'done' } | { kind: 'percent'; text: string } {
  if (args.nowPlaying) return { kind: 'playing' };
  if (args.finished) return { kind: 'done' };
  if (args.progressPercent != null && args.progressPercent > 0) {
    return { kind: 'percent', text: `${args.progressPercent} %` };
  }
  return { kind: 'none' };
}
