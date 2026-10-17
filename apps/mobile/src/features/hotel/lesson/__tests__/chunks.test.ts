import { describe, expect, it } from 'vitest';

import { buildSentenceChunks } from '../lesson-model';

describe('buildSentenceChunks', () => {
  it('glues punctuation to the word before it', () => {
    const chunks = buildSentenceChunks([
      { text: 'Я' },
      { text: 'живу' },
      { text: 'в' },
      { text: 'городе', isPunct: false },
      { text: '.', isPunct: true },
    ]);
    expect(chunks.map((c) => c.text)).toEqual(['Я', 'живу', 'в', 'городе.']);
    expect(chunks[3]!.tokenIndices).toEqual([3, 4]);
    expect(chunks[3]!.wordIndex).toBe(3);
  });

  it('keeps a leading punctuation mark as its own non-word chunk', () => {
    const chunks = buildSentenceChunks([{ text: '«', isPunct: true }, { text: 'Да' }]);
    expect(chunks[0]).toEqual({ text: '«', wordIndex: -1, tokenIndices: [0] });
    expect(chunks[1]!.wordIndex).toBe(1);
  });
});
