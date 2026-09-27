import type { MetaIntent } from './meta-intents';

/**
 * The five spoken commands as the «?» sheet and the intro's «What you can
 * say» row present them (T62 §6 / §9.2) — the one place text is allowed at
 * any time, because it teaches the mechanism, not the answer.
 */
export interface SpokenCommand {
  intent: MetaIntent;
  ru: string;
  en: string;
  hint: string;
}

export const SPOKEN_COMMANDS: readonly SpokenCommand[] = [
  { intent: 'repeat', ru: 'Повтори', en: 'Repeat', hint: 'The host says the line again.' },
  { intent: 'slower', ru: 'Помедленнее', en: 'Slower', hint: 'The same line at 0.8×.' },
  {
    intent: 'explain',
    ru: 'Что значит …?',
    en: 'What does … mean?',
    hint: 'Say the Russian word you heard; the host explains it in character.',
  },
  {
    intent: 'howtosay',
    ru: 'Как сказать …?',
    en: 'How do you say …?',
    hint: 'Say the English word; the host tells you the Russian.',
  },
  {
    intent: 'dont-understand',
    ru: 'Я не понимаю',
    en: "I don't understand",
    hint: 'The host gives a hint. Twice unlocks the text lifeline.',
  },
];
