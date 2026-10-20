import { describe, expect, it } from 'vitest';
import { gradeForm, GrammarAttemptSchema } from '../model';

describe('meaning before endings', () => {
  it('requires the intended meaning and exact reviewed case ending', () => {
    expect(gradeForm('gc-location-1', 'Где?', 'Коридоре.')).toBe(true);
    expect(gradeForm('gc-location-1', 'Куда?', 'коридоре')).toBe(false);
    expect(gradeForm('gc-location-1', 'Где?', 'коридор')).toBe(false);
    expect(gradeForm('gc-destination-2', 'Куда?', 'Я вхожу в комнату.')).toBe(true);
    expect(gradeForm('missing', 'Где?', 'коридоре')).toBe(false);
  });
  it('rejects invented grader/provenance at the storage boundary', () => {
    expect(GrammarAttemptSchema.safeParse({ grader: 'official-torfl' }).success).toBe(false);
  });
});
