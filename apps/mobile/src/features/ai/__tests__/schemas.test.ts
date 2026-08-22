import { describe, expect, it } from 'vitest';

import {
  extractJsonObject,
  JournalFeedbackSchema,
  parseStoredFeedback,
  StoredFeedbackSchema,
} from '../schemas';

describe('extractJsonObject', () => {
  it('parses bare JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips markdown fences and prose around the object', () => {
    const wrapped = 'Here you go:\n```json\n{"a": "б"}\n```\nHope that helps!';
    expect(extractJsonObject(wrapped)).toEqual({ a: 'б' });
  });

  it('returns null for no object or broken JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"a": }')).toBeNull();
  });
});

describe('journal feedback schemas', () => {
  const valid = {
    corrected: 'Я иду домой.',
    changes: [{ before: 'идти', after: 'иду', explanation: 'Conjugate the verb.' }],
    summary: 'Good work.',
  };

  it('accepts a well-formed feedback object', () => {
    expect(JournalFeedbackSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an empty changes array (already-correct entry)', () => {
    expect(JournalFeedbackSchema.safeParse({ ...valid, changes: [] }).success).toBe(true);
  });

  it('rejects missing summary or corrected', () => {
    expect(JournalFeedbackSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
    const { corrected: _c, ...rest } = valid;
    expect(JournalFeedbackSchema.safeParse(rest).success).toBe(false);
  });

  it('round-trips the stored envelope through parseStoredFeedback', () => {
    const stored = {
      v: 1,
      ...valid,
      sourceRu: 'Я идти домой.',
      model: 'anthropic/claude-sonnet-5',
      createdAt: 1_700_000_000_000,
    };
    expect(StoredFeedbackSchema.safeParse(stored).success).toBe(true);
    expect(parseStoredFeedback(JSON.stringify(stored))).toEqual(stored);
  });

  it('parseStoredFeedback degrades to null on garbage — never throws', () => {
    expect(parseStoredFeedback(null)).toBeNull();
    expect(parseStoredFeedback('not json')).toBeNull();
    expect(parseStoredFeedback('{"v":2}')).toBeNull();
  });
});
