import { EXAM_SUBTEST_KINDS } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  SUBTEST_LABELS,
  SUBTEST_ORDER,
  TOPICS,
  TOPIC_ORDER,
  compareTopics,
  isKnownTopic,
  topicLabel,
} from '../topics';

describe('topics (TORFL §3.4)', () => {
  it('covers the 27 §3.4 slugs + the 11 A2 additions with their subtest kind', () => {
    expect(TOPIC_ORDER).toHaveLength(38);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'lexgram')).toHaveLength(21);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'reading')).toHaveLength(5);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'listening')).toHaveLength(7);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'writing')).toHaveLength(2);
    expect(topicLabel('case-prep')).toEqual({
      ru: 'Предложный',
      en: 'Prepositional case',
      subtestKind: 'lexgram',
    });
    expect(topicLabel('speak-monologue').ru).toBe('Монолог');
  });

  it('the 11 A2 slugs carry their T75 RU labels and sort after their A1 neighbours', () => {
    expect(topicLabel('lex-phrases')).toEqual({
      ru: 'Речевой этикет',
      en: 'Speech etiquette',
      subtestKind: 'lexgram',
    });
    expect(topicLabel('case-plural').ru).toBe('Падежи во мн. числе');
    expect(topicLabel('case-time').ru).toBe('Время и даты');
    expect(topicLabel('numerals').ru).toBe('Числительные');
    expect(topicLabel('comparative').ru).toBe('Сравнение');
    expect(topicLabel('verb-motion-prefix').ru).toBe('Приставочные глаголы движения');
    expect(topicLabel('clauses').ru).toBe('Сложное предложение');
    expect(topicLabel('read-match').ru).toBe('Какой фильм?');
    expect(topicLabel('listen-goal').ru).toBe('Цель диалога');
    expect(topicLabel('listen-monologue').ru).toBe('Монолог');
    expect(topicLabel('write-note').ru).toBe('Записка / сообщение');
    expect(compareTopics('conj', 'lex-phrases')).toBeLessThan(0);
    expect(compareTopics('write-letter', 'write-note')).toBeLessThan(0);
  });

  it('an unknown slug renders raw (never dropped)', () => {
    expect(topicLabel('case-voc')).toEqual({ ru: 'case-voc', en: 'case-voc', subtestKind: null });
    expect(isKnownTopic('constructor')).toBe(false);
  });

  it('compareTopics: §3.4 order first, unknown slugs last alphabetically', () => {
    expect(['conj', 'zz-new', 'case-gen', 'aa-new', 'lex-verbs'].sort(compareTopics)).toEqual([
      'lex-verbs',
      'case-gen',
      'conj',
      'aa-new',
      'zz-new',
    ]);
  });

  it('SUBTEST_LABELS: the five official titles in SPbU order', () => {
    expect(SUBTEST_ORDER).toEqual(EXAM_SUBTEST_KINDS);
    expect(SUBTEST_ORDER.map((k) => SUBTEST_LABELS[k].ru)).toEqual([
      'Письмо',
      'Лексика. Грамматика',
      'Чтение',
      'Аудирование',
      'Говорение',
    ]);
  });
});

describe('bank a topic (pure)', () => {
  it('gated to category torfl + tag torfl:lexicon', async () => {
    const { canBankTopic } = await import('../bank-topic');
    expect(canBankTopic({ category: 'torfl', tags: ['torfl', 'torfl:lexicon'] })).toBe(true);
    expect(canBankTopic({ category: 'torfl', tags: ['torfl'] })).toBe(false);
    expect(canBankTopic({ category: null, tags: ['torfl:lexicon'] })).toBe(false);
    expect(canBankTopic({ category: 'stories', tags: ['family:tall-dog'] })).toBe(false);
  });

  it('toast copy + topic slug', async () => {
    const { bankTopicToast, topicSlugOfStory } = await import('../bank-topic');
    expect(bankTopicToast(1)).toBe('+1 слово в Словаре');
    expect(bankTopicToast(23)).toBe('+23 слова в Словаре');
    expect(bankTopicToast(67)).toBe('+67 слов в Словаре');
    expect(bankTopicToast(0)).toBe('+0 слов — все слова уже в Словаре');
    expect(topicSlugOfStory('lx-o-sebe')).toBe('o-sebe');
    expect(topicSlugOfStory('rd-01')).toBe('rd-01');
  });
});
