import { describe, expect, it } from 'vitest';

import { generateUnitQuiz, type QuizSentence, type QuizToken } from '../exercises/unit-quiz';

/** T17: unit-quiz generation from unit sentences (schema-valid by construction). */

function word(text: string, lemma: string, translation: string, pos = 'noun'): QuizToken {
  return {
    text,
    isPunct: false,
    spaceBefore: true,
    lemma,
    lemmaNorm: lemma.toLowerCase().replaceAll('ё', 'е'),
    translation,
    pos,
  };
}

function punct(text: string): QuizToken {
  return {
    text,
    isPunct: true,
    spaceBefore: false,
    lemma: null,
    lemmaNorm: null,
    translation: null,
    pos: null,
  };
}

function sentence(id: string, words: [string, string, string][], en: string): QuizSentence {
  const tokens = words.map(([t, l, g], i) => ({ ...word(t, l, g), spaceBefore: i > 0 }));
  tokens.push(punct('.'));
  return { id, ru: words.map(([t]) => t).join(' ') + '.', en, tokens };
}

const SENTENCES: QuizSentence[] = [
  sentence(
    's1',
    [
      ['В', 'в', 'in'],
      ['подвале', 'подвал', 'cellar'],
      ['стоит', 'стоять', 'stands'],
      ['кровать', 'кровать', 'bed'],
    ],
    'A bed stands in the cellar.',
  ),
  sentence(
    's2',
    [
      ['На', 'на', 'on'],
      ['стене', 'стена', 'wall'],
      ['висит', 'висеть', 'hangs'],
      ['пальто', 'пальто', 'coat'],
    ],
    'A coat hangs on the wall.',
  ),
  sentence(
    's3',
    [
      ['Под', 'под', 'under'],
      ['полом', 'пол', 'floor'],
      ['лежит', 'лежать', 'lies'],
      ['письмо', 'письмо', 'letter'],
    ],
    'A letter lies under the floor.',
  ),
  sentence(
    's4',
    [
      ['Ночью', 'ночь', 'at night'],
      ['дома', 'дом', 'at home'],
      ['очень', 'очень', 'very'],
      ['тихо', 'тихо', 'quiet'],
    ],
    'At night the house is very quiet.',
  ),
  sentence(
    's5',
    [
      ['Я', 'я', 'I'],
      ['слышу', 'слышать', 'hear'],
      ['стук', 'стук', 'a knock'],
    ],
    'I hear a knock.',
  ),
];

describe('generateUnitQuiz', () => {
  it('builds a mixed, schema-valid quiz from unit sentences', () => {
    const specs = generateUnitQuiz(SENTENCES);
    expect(specs.length).toBeGreaterThanOrEqual(6);
    const kinds = new Set(specs.map((s) => s.kind));
    expect(kinds.has('multiple-choice')).toBe(true);
    expect(kinds.has('cloze')).toBe(true);
    // Zod already ran inside the generator; ids must be unique.
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it('cloze specs blank a real token and include the answer among choices', () => {
    const specs = generateUnitQuiz(SENTENCES);
    for (const spec of specs.filter((s) => s.kind === 'cloze')) {
      expect(spec.sentenceRu).toContain('___');
      expect(spec.choices).toBeDefined();
      expect(spec.choices!).toContain(spec.answer);
      expect(new Set(spec.choices!.map((c) => c.toLowerCase())).size).toBe(spec.choices!.length);
    }
  });

  it('MC specs point correctIndex at the target translation with distinct choices', () => {
    const specs = generateUnitQuiz(SENTENCES);
    for (const spec of specs.filter((s) => s.kind === 'multiple-choice')) {
      expect(spec.choices[spec.correctIndex]).toBeDefined();
      expect(new Set(spec.choices.map((c) => c.toLowerCase())).size).toBe(spec.choices.length);
    }
  });

  it('sentence-builder tiles are lowercased and match the sentence word count', () => {
    const specs = generateUnitQuiz(SENTENCES);
    for (const spec of specs.filter((s) => s.kind === 'sentence-builder')) {
      expect(spec.tokens.every((t) => t === t.toLowerCase())).toBe(true);
      const source = SENTENCES.find((s) => s.en === spec.en)!;
      expect(spec.tokens).toHaveLength(source.tokens.filter((t) => !t.isPunct).length);
    }
  });

  it('returns an empty quiz for empty content instead of throwing', () => {
    expect(generateUnitQuiz([])).toEqual([]);
  });
});
