import type { ChatMessage } from '../client';

/**
 * The two суфлёр one-liners (T60, SPEAKING_SCENARIOS §6): when neither the
 * glossary nor the played host lines (nor Whisper) answered a meta-intent
 * and the device is online, a fast model supplies ONE short line that the
 * prompter SPEAKS — the text is never shown. Plain text, no JSON.
 */

const EXPLAIN_SYSTEM = `You are the off-stage prompter in a Russian speaking role-play for an A1–A2 English-speaking learner. The learner asked what a Russian word or short phrase means (it comes from automatic speech recognition and may be misspelled — infer the intended word). Reply with ONE short English gloss of at most eight words: the meaning only, no Russian, no quotes, no explanation, no prose. If it is unintelligible, reply exactly: unknown`;

const HOWTOSAY_SYSTEM = `You are the off-stage prompter in a Russian speaking role-play for an A1–A2 English-speaking learner. The learner asked how to say an English word or short phrase in Russian. The input may be the English itself or a Cyrillic garble of it from Russian speech recognition — infer the intended English. Reply with ONE natural spoken Russian rendering for a beginner, at most six words, Cyrillic only, no translation, no quotes, no explanation. If it is unintelligible, reply exactly: unknown`;

export function buildScenarioExplainMessages(query: string): ChatMessage[] {
  return [
    { role: 'system', content: EXPLAIN_SYSTEM },
    { role: 'user', content: `Word or phrase: «${query}»` },
  ];
}

export function buildScenarioHowToSayMessages(query: string): ChatMessage[] {
  return [
    { role: 'system', content: HOWTOSAY_SYSTEM },
    { role: 'user', content: `Translate to natural spoken Russian for a beginner: ${query}` },
  ];
}

/** The model's escape hatch — the caller treats it as "nothing found". */
export const HELP_UNKNOWN = 'unknown';

/** Trim + bound a one-liner; null for the escape hatch or an empty/oversized reply. */
export function parseHelpLine(content: string, maxChars = 80): string | null {
  const line =
    content
      .trim()
      .split('\n')[0]
      ?.trim()
      .replace(/^["«»']+|["«»']+$/g, '') ?? '';
  if (!line || line.toLowerCase() === HELP_UNKNOWN || line.length > maxChars) return null;
  return line;
}
