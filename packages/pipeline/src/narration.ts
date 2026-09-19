import type { Sentence, Story } from '@sumrak/schema';

/**
 * Narration text construction (T09). The text sent to ElevenLabs is built
 * from the story's sentences using the exact same spacing rules the schema's
 * `reconstructSentenceRu` enforces, so every token's character span in the
 * narration text is known precisely at build time — timestamp mapping never
 * has to *search* for a token, only to look up what the synthesizer said
 * about characters we placed ourselves.
 */

/** Where one token of one sentence sits inside the narration text. */
export interface TokenSpan {
  sentenceId: string;
  tokenIndex: number;
  /** Inclusive start offset in the narration text. */
  start: number;
  /** Exclusive end offset in the narration text. */
  end: number;
  /** Punctuation tokens get no word stamps (karaoke highlights words). */
  isPunct: boolean;
}

export interface NarrationText {
  /** The full text to synthesize, sentences separated by SENTENCE_SEPARATOR. */
  text: string;
  /** One span per token, in reading order. */
  spans: TokenSpan[];
  /**
   * Character ranges of rendered-then-cut context narration (`contextCues`):
   * each is `[start, end)` in `text`, belongs to no token, and is excised
   * from the audio after rendering.
   */
  cuts?: { start: number; end: number }[];
}

/**
 * Separator between sentences in the narration text. A paragraph break gives
 * the TTS model a natural pause boundary without inventing punctuation that
 * isn't in the content.
 */
export const SENTENCE_SEPARATOR = '\n\n';

/** Build the narration text and per-token character spans for one story. */
export function buildNarration(story: Story): NarrationText {
  return buildNarrationFromSentences(story.sentences);
}

/**
 * Sentence-list variant (T26): dialogue nodes/choices render one sentence per
 * request, but the spacing/span rules are identical to story narration.
 */
export function buildNarrationFromSentences(sentenceList: readonly Sentence[]): NarrationText {
  let text = '';
  const spans: TokenSpan[] = [];

  sentenceList.forEach((sentence, si) => {
    if (si > 0) text += SENTENCE_SEPARATOR;
    sentence.tokens.forEach((token, ti) => {
      // Mirror of reconstructSentenceRu's spacing defaults — the schema
      // guarantees the tokens rebuild `ru` exactly under these rules.
      const space = token.spaceBefore ?? (ti > 0 && !token.isPunct);
      if (space) text += ' ';
      const start = text.length;
      text += token.text;
      spans.push({
        sentenceId: sentence.id,
        tokenIndex: ti,
        start,
        end: text.length,
        isPunct: token.isPunct === true,
      });
    });
  });

  return { text, spans };
}
