import type { ChatMessage } from '../client';

/**
 * "Explain this" prompt (ticket feature 3): ad-hoc explanation of a
 * sentence (reader/journal) or a bank card. Response is plain markdown
 * prose — no JSON contract, rendered by MarkdownView. Results are
 * transient (session cache only, not persisted — recorded ticket decision).
 */

export type ExplainTarget =
  | {
      kind: 'sentence';
      ru: string;
      /** Pack translation when we have one (reader sentences). */
      en?: string;
      /** Where it came from, for flavor ("Ночные гости"). */
      sourceTitle?: string;
    }
  | {
      kind: 'card';
      headword: string;
      translation?: string;
      /** Surface form as first met — the saved grammar note describes THIS. */
      surface?: string;
      grammar?: string;
      pos?: string;
      /** An example sentence the learner met the word in. */
      exampleRu?: string;
    };

const SYSTEM = `You are a Russian tutor for an English-speaking adult learner (~A1–B1). Explain clearly and concisely in English, in markdown.

For a sentence: give a natural translation (if not provided, or improve on the provided one only if needed), then break down the grammar that a learner at this level would stumble on — case endings, verb aspect/tense, word order, idioms. Use a short bullet list per interesting word or construction. Skip trivial words.

For a word or phrase: explain what it means, its grammar (declension/conjugation class, aspect pair for verbs), when to use it vs. near-synonyms, and give 2-3 short example sentences with translations. Mention any false friends or common learner mistakes.

Keep it under ~250 words. No preamble — start with the content.`;

export function buildExplainMessages(target: ExplainTarget): ChatMessage[] {
  let user: string;
  if (target.kind === 'sentence') {
    const parts = [`Explain this Russian sentence:\n\n«${target.ru}»`];
    if (target.en) parts.push(`Provided translation: "${target.en}"`);
    if (target.sourceTitle) parts.push(`(from «${target.sourceTitle}»)`);
    user = parts.join('\n');
  } else {
    const parts = [`Explain this Russian ${target.pos ?? 'word or phrase'}: «${target.headword}»`];
    if (target.translation) parts.push(`My saved translation: "${target.translation}"`);
    if (target.surface && target.surface !== target.headword) {
      parts.push(`I first met it as the form «${target.surface}»`);
      if (target.grammar) parts.push(`Saved grammar note (about that form): ${target.grammar}`);
    } else if (target.grammar) {
      parts.push(`Saved grammar note: ${target.grammar}`);
    }
    if (target.exampleRu) parts.push(`I met it in: «${target.exampleRu}»`);
    user = parts.join('\n');
  }
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
