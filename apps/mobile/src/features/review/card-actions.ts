import { repos } from '@/db';
import type { CardRow } from '@/db/repositories/reviews';
import { track } from '@/services/analytics';

/**
 * T39 card-management actions. The UI calls ONLY `applyCardAction` — it runs
 * the repo write, fires the analytics event (kind/direction/source only, never
 * lemma text) and returns the updated row. Pure of React: the UI invalidates
 * its own React Query caches.
 */
export type CardActionKind = 'suspend' | 'unsuspend' | 'bury' | 'unbury' | 'reset';
export type CardActionSource = 'item-detail' | 'leech-inbox';

export async function applyCardAction(
  kind: CardActionKind,
  card: { id: string; direction: string },
  from: CardActionSource,
  now: number = Date.now(),
): Promise<CardRow> {
  const reviews = repos.reviews;
  switch (kind) {
    case 'suspend':
      await reviews.suspendCard(card.id, now);
      break;
    case 'unsuspend':
      await reviews.unsuspendCard(card.id);
      break;
    case 'bury':
      await reviews.buryUntilTomorrow(card.id, now);
      break;
    case 'unbury':
      await reviews.unburyCard(card.id);
      break;
    case 'reset':
      await reviews.resetCard(card.id, now);
      break;
  }
  track('card_action', { kind, direction: card.direction, from });
  const updated = await reviews.getCardById(card.id);
  if (!updated) throw new Error(`applyCardAction: card ${card.id} not found`);
  return updated;
}
