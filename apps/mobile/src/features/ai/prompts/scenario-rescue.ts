import type { Slot } from '@sumrak/schema';

import type { ChatMessage } from '../client';

/**
 * The online rescue judge (T60, SPEAKING_SCENARIOS §5.3, ADR-0019
 * decision 2): ONE fast-model call that may accept an off-script-but-valid
 * answer the offline judge missed. The system prompt is VERBATIM from the
 * design file — do not edit it here without editing §5.3 in the same
 * session. `{LANGUAGE_NAME}` is the only substitution.
 */

export const RESCUE_SYSTEM_TEMPLATE = `You judge ONE spoken answer in a scripted {LANGUAGE_NAME} role-play for an A1–A2 learner. You get the host's question (with English), what a valid answer must contain, and an automatic speech-recognition transcript of the learner (it may misspell endings or drop short words). Decide whether a patient native speaker would accept the answer as a sensible reply to the question. Accept honest paraphrases, extra words, small grammar slips and ASR-shaped misspellings. Reject answers that do not address the question, are a different speech act (a thank-you instead of an answer), or are empty noise. Reply with exactly one JSON object: {"verdict":"accept"|"reject","branchKey":string|null,"reason":string} where branchKey is one of the allowed keys when the answer clearly picks one, else null. No prose.`;

export const LANGUAGE_NAMES: Record<'ru' | 'uk', string> = {
  ru: 'Russian',
  uk: 'Ukrainian',
};

export interface RescueInput {
  language: 'ru' | 'uk';
  /** The host's prompt line (the last say-line of the turn). */
  questionRu: string;
  questionEn: string;
  slots: readonly Slot[];
  accept: readonly string[];
  /** Keys `next.on` can branch on (empty for linear turns). */
  allowedKeys: readonly string[];
  transcript: string;
}

/** «where: head|stomach|throat (required)» — one line per slot (§5.3). */
export function describeSlot(slot: Slot): string {
  const req = slot.required ? 'required' : 'optional';
  if (slot.kind === 'forms') {
    const keys = slot.options.map((o) => o.key);
    if (slot.acceptsNumber) keys.push('number');
    return `${slot.id}: ${keys.join('|')} (${req})`;
  }
  if (slot.kind === 'number') return `${slot.id}: a number (${req})`;
  const cues = slot.cues && slot.cues.length > 0 ? `, with one of: ${slot.cues.join(' / ')}` : '';
  return `${slot.id}: any answer of ≥ ${slot.minTokens} content word${slot.minTokens === 1 ? '' : 's'}${cues} (${req})`;
}

export function buildRescueMessages(input: RescueInput): ChatMessage[] {
  const system = RESCUE_SYSTEM_TEMPLATE.replace('{LANGUAGE_NAME}', LANGUAGE_NAMES[input.language]);
  const user = [
    `Question: «${input.questionRu}» — "${input.questionEn}"`,
    'A valid answer contains:',
    ...input.slots.map((s) => `- ${describeSlot(s)}`),
    `Accepted paraphrases: ${input.accept.map((a) => `«${a}»`).join(' | ')}`,
    `Allowed branch keys: ${input.allowedKeys.length > 0 ? input.allowedKeys.join(', ') : 'none (reply null)'}`,
    `Transcript: «${input.transcript}»`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
