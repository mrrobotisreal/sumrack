import type { ChatMessage } from '../client';

/**
 * "Explain this" prompt (ticket feature 3): ad-hoc explanation of a
 * sentence (reader/journal) or a bank card. Response is plain markdown
 * prose — no JSON contract, rendered by MarkdownView. Results are
 * transient (session cache only, not persisted — recorded ticket decision).
 */

export type ExplainTarget =
  | {
      kind: 'course-card';
      /** Cache key: the course card id (`packId/unitId/cardId`, see explain.ts). */
      id: string;
      title: string;
      body: string;
      /** The card's example sentences in Russian (no translation: English is authored). */
      examples: string[];
    }
  | {
      kind: 'course-item';
      /** Cache key: the course item id (`packId/itemId`). */
      id: string;
      stem: string;
      options?: string[];
      /** The learner's pick (the option text), when they answered wrong. */
      chosen?: string;
      /** The correct answer (the option text, or the accepted form). */
      correct: string;
      /** The authored explanation the learner already read. */
      explain: string;
      topic: string;
    }
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
      /**
       * T38 leech framing: the card keeps failing — the same template plus a
       * "why might this be hard + memory hooks" request (prompt reuse, not a
       * new template; recorded).
       */
      leech?: { againCount: number; windowSize: number; direction: string };
    };

const SYSTEM = `You are a Russian tutor for an English-speaking adult learner (~A1–B1). Explain clearly and concisely in English, in markdown.

For a sentence: give a natural translation (if not provided, or improve on the provided one only if needed), then break down the grammar that a learner at this level would stumble on — case endings, verb aspect/tense, word order, idioms. Use a short bullet list per interesting word or construction. Skip trivial words.

For a word or phrase: explain what it means, its grammar (declension/conjugation class, aspect pair for verbs), when to use it vs. near-synonyms, and give 2-3 short example sentences with translations. Mention any false friends or common learner mistakes.

Keep it under ~250 words. No preamble — start with the content.`;

/** Course prompts (T90 D9): English answer, ≤ 250 words, three new A1 examples, the chosen option named as wrong. */
const COURSE_SYSTEM = `You are a Russian tutor for an English-speaking adult learner at A1. Answer in English, in markdown, at most 250 words, no preamble.

Explain the grammar differently from the authored explanation the learner has already read: a new angle, a new picture of the rule. Give exactly three NEW A1 example sentences with English translations, none copied from the lesson. If the learner chose a wrong option, say plainly why that chosen option is wrong for this sentence. Keep the Russian plain (no Ukrainian letters: і ї є ґ).`;

const COURSE_CARD_SYSTEM = `You are a Russian tutor for an English-speaking adult learner at A1. Answer in English, in markdown, at most 250 words, no preamble.

Re-explain this lesson card in a fresh way: restate the rule in plain English, name the trigger, and give exactly three NEW A1 example sentences with English translations, none copied from the card. Keep the Russian plain (no Ukrainian letters: і ї є ґ).`;

export function buildExplainMessages(target: ExplainTarget): ChatMessage[] {
  if (target.kind === 'course-card') {
    const parts = [
      `Lesson card: «${target.title}»`,
      target.body,
      target.examples.length > 0
        ? `Examples from the card:\n${target.examples.map((e) => `- ${e}`).join('\n')}`
        : '',
    ].filter((p) => p !== '');
    return [
      { role: 'system', content: COURSE_CARD_SYSTEM },
      { role: 'user', content: parts.join('\n\n') },
    ];
  }
  if (target.kind === 'course-item') {
    const parts = [`Exercise sentence: «${target.stem}»`, `Topic: ${target.topic}`];
    if (target.options && target.options.length > 0) {
      parts.push(`Options: ${target.options.map((o) => `«${o}»`).join(', ')}`);
    }
    parts.push(`Correct answer: «${target.correct}»`);
    if (target.chosen !== undefined && target.chosen !== target.correct) {
      parts.push(`The learner chose: «${target.chosen}» (wrong)`);
    }
    parts.push(`The authored explanation the learner already read: ${target.explain}`);
    return [
      { role: 'system', content: COURSE_SYSTEM },
      { role: 'user', content: parts.join('\n') },
    ];
  }
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
    if (target.leech) {
      parts.push(
        `This card is a leech for me: I answered "Again" ${target.leech.againCount} times in my last ${target.leech.windowSize} reviews (direction ${target.leech.direction}). Start with why this word might be hard for an English speaker (look-alikes, confusable forms, stress, aspect), then give one or two concrete memory hooks.`,
      );
    }
    user = parts.join('\n');
  }
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
