import type { ChatMessage } from '../client';

/**
 * Batch enrichment prompt (design §7.4): fill lemma/translation/grammar/
 * POS/CEFR for bank items captured outside packs with only a surface form.
 * Response contract = EnrichmentResponseSchema; ids are echoed so the
 * proposals can be joined back (unknown ids get dropped by the caller).
 */

export interface EnrichmentItemInput {
  id: string;
  kind: 'word' | 'phrase';
  /** Surface form as highlighted ("словами", "по крайней мере"). */
  surface: string;
  /** Existing translation, if the user typed one at save time. */
  translation?: string;
  /** A snippet of the sentence/entry the item was highlighted in. */
  context?: string;
}

const SYSTEM = `You are a Russian lexicographer producing dictionary annotations for a learner's word bank. Each input item is a word or phrase highlighted from real Russian text, with optional surrounding context.

For each item return:
- "lemma" (words only): the dictionary form — nominative singular for nouns, infinitive (imperfective unless the surface is clearly perfective) for verbs, masculine nominative singular for adjectives. Omit for phrases and proper names that ARE their own form.
- "translation": a concise English gloss fitting the context if one is given. If the user already has a translation, keep it unless it is wrong.
- "grammar" (optional): a compact note about the SURFACE form ("gen.pl.", "pf. of говорить", "short adj."). Omit if the surface is the dictionary form and nothing is notable.
- "pos" (words only): one of noun, verb, adj, adv, pron, prep, conj, part, num, interj.
- "level": CEFR level of the lemma/phrase: A1, A2, B1, B2, or C1. Estimate honestly; C1 for anything rare.

Preserve ё in lemmas where standard dictionaries use it. Use lowercase for lemmas except proper names.

Respond with ONLY a JSON object, no markdown fences:
{ "items": [ { "id": "<echoed id>", "lemma": "...", "translation": "...", "grammar": "...", "pos": "...", "level": "..." } ] }

Echo every input id exactly once. Omit optional fields rather than guessing wildly.`;

export function buildEnrichmentMessages(items: EnrichmentItemInput[]): ChatMessage[] {
  const lines = items.map((item) => {
    const parts = [`id: ${item.id}`, `kind: ${item.kind}`, `surface: ${item.surface}`];
    if (item.translation) parts.push(`user translation: ${item.translation}`);
    if (item.context) parts.push(`context: …${item.context}…`);
    return `- ${parts.join(' | ')}`;
  });
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Annotate these items:\n\n${lines.join('\n')}` },
  ];
}
