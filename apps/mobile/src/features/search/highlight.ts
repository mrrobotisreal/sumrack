import { normalizeRu } from '@/db/normalize';

/**
 * Match highlighting for global-search snippets (T24). The FTS layer tells
 * us which token surfaces matched (`matchedTexts` — lemma matches included,
 * e.g. searching «слово» matches the token «словами»); here we mark the
 * whitespace chunks of the sentence whose letter core is one of them,
 * ё/е-tolerant by normalizing both sides. Pure and tested.
 */

export interface SnippetSegment {
  text: string;
  matched: boolean;
}

const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function highlightSnippet(ru: string, matchedTexts: string[]): SnippetSegment[] {
  const matched = new Set(matchedTexts.map((t) => normalizeRu(t)));
  return ru
    .split(/(\s+)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const core = part.replace(EDGE_PUNCT, '');
      return {
        text: part,
        matched: core.length > 0 && matched.has(normalizeRu(core)),
      };
    });
}
