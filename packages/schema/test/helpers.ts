/** A minimal, structurally valid `stories` pack for tests to mutate. */
export function makeValidPack(): Record<string, unknown> {
  return structuredClone({
    id: 'test-pack-001',
    version: 1,
    type: 'stories',
    title: { ru: 'Тест', en: 'Test' },
    level: 'A1',
    tags: ['test'],
    stories: [
      {
        id: 'test-story',
        title: { ru: 'Тест', en: 'Test' },
        level: 'A1',
        audio: [],
        sentences: [
          {
            id: 'test-s01',
            ru: 'Я дома.',
            en: 'I am home.',
            tokens: [
              {
                text: 'Я',
                lemma: 'я',
                translation: 'I',
                pos: 'pron',
                grammar: 'nom.',
                level: 'A1',
              },
              { text: 'дома', lemma: 'дома', translation: 'at home', pos: 'adv', level: 'A1' },
              { text: '.', isPunct: true },
            ],
          },
        ],
      },
    ],
  });
}
