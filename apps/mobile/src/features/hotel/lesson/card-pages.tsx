import type { CourseCard, CourseUnit, LibraryQuote } from '@sumrak/schema';
import * as React from 'react';

import type { TokenRow } from '@/db/repositories/content';

import { CheckCardView } from './check-card';
import {
  EdgeCardView,
  ExplainCardView,
  LibraryCardView,
  TrapsCardView,
  type SentenceMap,
} from './cards';

/**
 * Renders one card of a unit's lesson by its kind (T90 decision 1). The
 * screen owns the pager; this only maps a card to its view.
 */
export function CardPages({
  packId,
  unit,
  card,
  sentences,
  sourceTitles,
  onWordPress,
  onReadMore,
  onQuotePlayed,
}: {
  packId: string;
  unit: CourseUnit;
  card: CourseCard;
  sentences: SentenceMap;
  sourceTitles: Map<string, string>;
  onWordPress: (token: TokenRow, storyId: string, sentenceId: string) => void;
  onReadMore: (quote: LibraryQuote) => void;
  onQuotePlayed: (quote: LibraryQuote) => void;
}) {
  // The sentence's story id is the one a sentence ref names; the cards pass it on lookup.
  const cb = {
    onWordPress: (token: TokenRow, sentenceId: string) => {
      const storyId = storyForSentence(card, sentenceId);
      onWordPress(token, storyId, sentenceId);
    },
    onReadMore,
    onQuotePlayed,
  };
  switch (card.kind) {
    case 'explain':
      return <ExplainCardView card={card} sentences={sentences} cb={cb} />;
    case 'edge':
      return <EdgeCardView card={card} sentences={sentences} cb={cb} />;
    case 'traps':
      return <TrapsCardView card={card} sentences={sentences} cb={cb} />;
    case 'library':
      return (
        <LibraryCardView card={card} sentences={sentences} sourceTitles={sourceTitles} cb={cb} />
      );
    case 'check':
      return <CheckCardView packId={packId} unit={unit} card={card} />;
  }
}

/** The story a sentence belongs to on this card (examples and quotes name it in their refs). */
function storyForSentence(card: CourseCard, sentenceId: string): string {
  if (card.kind === 'explain' || card.kind === 'edge') {
    const hit = card.examples.find((e) => e.sentenceRef.sentenceId === sentenceId);
    if (hit) return hit.sentenceRef.storyId;
  }
  if (card.kind === 'traps') {
    const hit = card.pairs.find((p) => p.right.sentenceId === sentenceId);
    if (hit) return hit.right.storyId;
  }
  if (card.kind === 'library') {
    const hit = card.quotes.find((q) => q.sentenceId === sentenceId);
    if (hit) return hit.storyId;
  }
  return '';
}
