import { TORFL_SUBTEST_ORDER, type ExamSubtestKind } from '@sumrak/schema';

import type { IoniconName } from '@/features/library/categories';

/**
 * «ТРКИ» labels the app owns (T69, TORFL_EXAM_PREP §3.4): packs carry topic
 * SLUGS only and the app renders them. Like the M14 category sets, an
 * unknown slug renders raw and is never dropped, so a CT session can coin a
 * topic before the app learns its label. Pure module, unit-tested.
 */

export interface TopicLabel {
  ru: string;
  en: string;
  subtestKind: ExamSubtestKind;
}

/**
 * §3.4, in table order (the hub's tile order inside a subtest tab), then the
 * TORFL_A2_EXAM_PREP §4 additions (T75): each A2 slug sits right after the
 * last A1 slug of its subtest kind, so the tile order is the A1 table then A2.
 */
export const TOPICS = {
  'lex-verbs': { ru: 'Глаголы-близнецы', en: 'Look-alike verbs', subtestKind: 'lexgram' },
  'lex-family': { ru: 'Однокоренные слова', en: 'Word families', subtestKind: 'lexgram' },
  'lex-negation': { ru: 'Не / нет', en: 'Negation', subtestKind: 'lexgram' },
  agr: { ru: 'Согласование', en: 'Agreement', subtestKind: 'lexgram' },
  pron: { ru: 'Местоимения', en: 'Pronouns', subtestKind: 'lexgram' },
  'case-prep': { ru: 'Предложный', en: 'Prepositional case', subtestKind: 'lexgram' },
  'case-acc': { ru: 'Винительный', en: 'Accusative case', subtestKind: 'lexgram' },
  'case-gen': { ru: 'Родительный', en: 'Genitive case', subtestKind: 'lexgram' },
  'case-dat': { ru: 'Дательный', en: 'Dative case', subtestKind: 'lexgram' },
  'case-instr': { ru: 'Творительный', en: 'Instrumental case', subtestKind: 'lexgram' },
  'verb-forms': {
    ru: 'Спряжение и императив',
    en: 'Conjugation & imperative',
    subtestKind: 'lexgram',
  },
  'verb-aspect': { ru: 'Вид и время', en: 'Aspect & tense', subtestKind: 'lexgram' },
  'verb-motion': { ru: 'Глаголы движения', en: 'Verbs of motion', subtestKind: 'lexgram' },
  conj: { ru: 'Союзы и вопросы', en: 'Conjunctions & questions', subtestKind: 'lexgram' },
  'lex-phrases': { ru: 'Речевой этикет', en: 'Speech etiquette', subtestKind: 'lexgram' },
  'case-plural': { ru: 'Падежи во мн. числе', en: 'Plural cases', subtestKind: 'lexgram' },
  'case-time': { ru: 'Время и даты', en: 'Time & dates', subtestKind: 'lexgram' },
  numerals: { ru: 'Числительные', en: 'Numerals', subtestKind: 'lexgram' },
  comparative: { ru: 'Сравнение', en: 'Comparison', subtestKind: 'lexgram' },
  'verb-motion-prefix': {
    ru: 'Приставочные глаголы движения',
    en: 'Prefixed verbs of motion',
    subtestKind: 'lexgram',
  },
  clauses: { ru: 'Сложное предложение', en: 'Complex sentences', subtestKind: 'lexgram' },
  'read-continue': { ru: 'Продолжите фразу', en: 'Continue the line', subtestKind: 'reading' },
  'read-signs': { ru: 'Объявления', en: 'Signs & notices', subtestKind: 'reading' },
  'read-topic': { ru: 'О чём статья?', en: 'What is it about?', subtestKind: 'reading' },
  'read-detail': { ru: 'Текст и вопросы', en: 'Text & questions', subtestKind: 'reading' },
  'read-match': { ru: 'Какой фильм?', en: 'Which film?', subtestKind: 'reading' },
  'listen-where': { ru: 'Где они?', en: 'Where are they?', subtestKind: 'listening' },
  'listen-who': { ru: 'Кто говорит?', en: 'Who is speaking?', subtestKind: 'listening' },
  'listen-phrase': { ru: 'Фраза-синоним', en: 'Same meaning', subtestKind: 'listening' },
  'listen-detail': { ru: 'Детали диалога', en: 'Dialogue details', subtestKind: 'listening' },
  'listen-info': { ru: 'Запишите информацию', en: 'Info capture', subtestKind: 'listening' },
  'listen-goal': { ru: 'Цель диалога', en: 'Purpose of the dialogue', subtestKind: 'listening' },
  'listen-monologue': { ru: 'Монолог', en: 'Monologue', subtestKind: 'listening' },
  'write-letter': { ru: 'Письмо', en: 'The letter', subtestKind: 'writing' },
  'write-note': { ru: 'Записка / сообщение', en: 'Note / message', subtestKind: 'writing' },
  'speak-reply': { ru: 'Ответьте', en: 'Reply', subtestKind: 'speaking' },
  'speak-situation': { ru: 'Начните диалог', en: 'Start the dialogue', subtestKind: 'speaking' },
  'speak-monologue': { ru: 'Монолог', en: 'Monologue', subtestKind: 'speaking' },
} as const satisfies Record<string, TopicLabel>;

export type TopicSlug = keyof typeof TOPICS;
export const TOPIC_ORDER = Object.keys(TOPICS) as TopicSlug[];

export function isKnownTopic(slug: string): slug is TopicSlug {
  return Object.prototype.hasOwnProperty.call(TOPICS, slug);
}

/** Known → its §3.4 label; unknown → the raw slug (subtest kind unknown → null). */
export function topicLabel(slug: string): {
  ru: string;
  en: string;
  subtestKind: ExamSubtestKind | null;
} {
  return isKnownTopic(slug) ? TOPICS[slug] : { ru: slug, en: slug, subtestKind: null };
}

/**
 * Sort key for topic slugs: §3.4 table order first, unknown slugs after,
 * alphabetically. Stable across renders (the hub's tile order).
 */
export function compareTopics(a: string, b: string): number {
  const ia = TOPIC_ORDER.indexOf(a as TopicSlug);
  const ib = TOPIC_ORDER.indexOf(b as TopicSlug);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface SubtestLabel {
  /** Official title («Лексика. Грамматика»). */
  ru: string;
  /** Short form for tabs and readiness rows («Лексика»). */
  short: string;
  en: string;
  icon: IoniconName;
}

/** The five subtests (TORFL §2), keyed by kind. */
export const SUBTEST_LABELS: Record<ExamSubtestKind, SubtestLabel> = {
  writing: { ru: 'Письмо', short: 'Письмо', en: 'Writing', icon: 'create-outline' },
  lexgram: {
    ru: 'Лексика. Грамматика',
    short: 'Лексика',
    en: 'Vocabulary & grammar',
    icon: 'extension-puzzle-outline',
  },
  reading: { ru: 'Чтение', short: 'Чтение', en: 'Reading', icon: 'reader-outline' },
  listening: { ru: 'Аудирование', short: 'Аудирование', en: 'Listening', icon: 'headset-outline' },
  speaking: { ru: 'Говорение', short: 'Говорение', en: 'Speaking', icon: 'mic-outline' },
};

/** Official SPbU order (§1.3 decision 7): Письмо → Лексика → Чтение → Аудирование → Говорение. */
export const SUBTEST_ORDER: readonly ExamSubtestKind[] = TORFL_SUBTEST_ORDER;
