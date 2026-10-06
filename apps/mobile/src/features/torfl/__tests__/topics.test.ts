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
  it('covers the 27 §3.4 slugs with their subtest kind', () => {
    expect(TOPIC_ORDER).toHaveLength(27);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'lexgram')).toHaveLength(14);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'reading')).toHaveLength(4);
    expect(TOPIC_ORDER.filter((t) => TOPICS[t].subtestKind === 'listening')).toHaveLength(5);
    expect(topicLabel('case-prep')).toEqual({
      ru: 'Предложный',
      en: 'Prepositional case',
      subtestKind: 'lexgram',
    });
    expect(topicLabel('speak-monologue').ru).toBe('Монолог');
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
