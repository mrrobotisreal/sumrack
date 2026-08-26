import type { ChatMessage } from '../client';

/**
 * Import annotation prompt (T29, design V2 §4.2): turn real-world Russian
 * sentences into the exact draft-table token contract the pipeline holds
 * Claude-authored packs to. The lemma conventions below are COPIED from
 * `packages/pipeline/docs/AUTHORING.md` (§Token table columns, §Gotchas 4)
 * — the app cannot read that doc at runtime; if the conventions change
 * there, update this template in the same session.
 *
 * Response contract = ImportAnnotateResponseSchema. Tokenization is the
 * contract's teeth: the token texts, in order, must rebuild each sentence
 * exactly (the schema reconstruction invariant); the app derives spacing
 * and punctuation flags itself, so the model authors neither.
 */

export interface AnnotateSentenceInput {
  /** Envelope uid, echoed back so results join to the right sentence. */
  id: string;
  /** The sentence exactly as it will appear in the app (NFC, single spaces). */
  ru: string;
}

const SYSTEM = `You are a Russian linguist annotating real-world Russian text (chat messages, articles, lyrics) for a learner's reading app. For each input sentence produce its natural English translation and a token table.

TOKENIZATION — the most important rule:
- Walk the sentence left to right and emit one token per word and one per punctuation mark, in order. Nothing skipped, nothing merged, nothing altered.
- The "text" fields, concatenated in order (with the original single spaces between words), must rebuild the input sentence EXACTLY, character for character. Never correct spelling, never change е/ё either way, never drop or normalize anything — the input text is the source of truth even when it contains typos.
- Hyphenated words stay ONE token («кто-то», «по-моему»). Punctuation marks (. , : ; ! ? … « » „ " ( ) —) are each their own token.
- Punctuation tokens get ONLY "text" — no other fields.

WORD TOKENS — required fields:
- "lemma": the dictionary form, lowercase (proper names keep their capital).
- "translation": what this occurrence means HERE, in context («стоит» in «В окне стоит человек» is "stands", not "costs").
Recommended: "pos", "grammar" (compact reader-facing notes like "f.sg. nom.", "1sg. pres. (impf.)", "+ gen.", "pf. of говорить"), "level" (CEFR of the LEMMA, A1–C1). Optional: "note" for idioms/culture.
- "pos" is one of: noun, verb, adj, adv, pron, prep, conj, part, pred, num, name, interj, foreign, other. "pred" covers impersonal predicatives («есть», «нет», «можно», «страшно» in «мне страшно»).

LEMMA CONVENTIONS (match them exactly — imported words must merge with existing vocabulary):
- Verbs → imperfective infinitive as a rule; a perfective surface form takes the PERFECTIVE infinitive as lemma with "pf. of <imperfective>" in grammar.
- Nouns/adjectives → nominative singular (masculine for adjectives).
- Personal pronoun forms («меня», «ней», «его» him) → their nominative («я», «она», «он»). Possessive «его/её/их» (his/her/their) → itself. Declining possessives «мой/твой/наш/ваш» → masculine nominative singular («моём» → «мой»), pos "pron".
- Pronoun-adjectives («этот», «каждый», «весь», «такой») → masculine nominative singular, pos "pron", adjective-style grammar notes.
- Numerals, cardinal and ordinal → pos "num", lemma = nominative («девять», «десятый»); note case government on the governed noun's row ("m.pl. gen. (after 5+)").
- Adverbs → the adverb itself, even frozen noun forms («дома» at home → «дома»; «утром» in the morning as adverb → «утром»).
- Preserve ё in lemmas where standard dictionaries use it («чёрный», «всё»).

REAL-WORLD TEXT RULES:
- Names of people/places → pos "name", lemma = the name's nominative form (capital kept), translation = the transliterated name; omit "level".
- Latin-script words (English words, brands) → one token, pos "foreign", lemma = the word exactly as written, translation = its meaning (or the word itself for brand names); omit "level".
- Digit tokens («25», «1999») → pos "num", lemma = the digits exactly as written, translation = the digits; omit "level".
- URLs, @handles, #hashtags → one token, pos "other", lemma = the token exactly as written, translation = a short label like "link" or "handle"; omit "level".
- Emoji and symbol-only tokens are punctuation: "text" only.

UNCERTAINTY: when you are genuinely unsure of a lemma or gloss (rare words, ambiguous slang, unclear names), add "uncertain": true to that token instead of guessing silently.

LEVEL ESTIMATE: include a top-level "level" — the overall CEFR difficulty (A1–C1) of these sentences for a learner.

All output text must be Unicode NFC. Respond with ONLY a JSON object, no markdown fences:
{ "level": "A2", "sentences": [ { "id": "<echoed id>", "en": "...", "tokens": [ { "text": "У", "lemma": "у", "translation": "at (possession)", "pos": "prep", "grammar": "+ gen.", "level": "A1" }, { "text": "." } ] } ] }

Echo every input sentence id exactly once. Omit optional fields rather than filling them with placeholders.`;

export function buildImportAnnotateMessages(sentences: AnnotateSentenceInput[]): ChatMessage[] {
  const lines = sentences.map((s) => `${s.id}: ${s.ru}`);
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Annotate these sentences:\n\n${lines.join('\n')}` },
  ];
}

/**
 * The one-shot reconstruction retry (ticket item 2): continue the same
 * conversation, show the model its raw output and the EXACT per-sentence
 * validation errors, and ask for only the failed sentences again.
 */
export function buildImportAnnotateRetryMessages(
  batch: AnnotateSentenceInput[],
  rawCompletion: string,
  failures: { id: string; error: string }[],
): ChatMessage[] {
  const errors = failures.map((f) => `${f.id}: ${f.error}`).join('\n');
  return [
    ...buildImportAnnotateMessages(batch),
    { role: 'assistant', content: rawCompletion },
    {
      role: 'user',
      content:
        `These sentences failed validation:\n\n${errors}\n\n` +
        `Remember: the "text" fields in order must rebuild the input sentence exactly — every character, every punctuation mark, original spelling untouched. ` +
        `Respond with ONLY a JSON object of the same shape containing ONLY the failed sentences, re-annotated.`,
    },
  ];
}
