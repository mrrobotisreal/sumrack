import { describe, expect, it } from 'vitest';

import {
  AssessmentResponseSchema,
  extractJsonObject,
  parseStoredAssessment,
  type StoredAssessment,
} from '@/features/ai/schemas';
import { buildAssessmentMessages } from '@/features/ai/prompts/assessment';

import { AUTO_ASSESS_INTERVAL_MS, bundleHasEvidence, shouldAutoAssess } from '../assessment-core';

/**
 * T18: assessment schema boundaries, prompt template contract, and the
 * auto-cadence gate. The live round-trip is covered by the recorded
 * fixture (fixtures.test.ts) + the on-device acceptance run.
 */

const validResponse = {
  skills: {
    reading: { level: 'A2', note: 'Reads A1–A2 stories with lookup support.' },
    listening: { level: 'A1', note: 'Evidence thin; some listening reviews.' },
    writing: { level: 'A1', note: 'Short entries with frequent case errors.' },
    speaking: { level: 'A1', note: 'Pronunciation proxy only — 92 avg vs ASR.' },
  },
  recommendations: ['Drill accusative vs prepositional after в/на.', 'Write longer entries.'],
  summary: 'Solid A1 with A2 reading emerging. Keep reading daily.',
};

describe('assessment schemas', () => {
  it('accepts a valid response and rejects out-of-range levels', () => {
    expect(AssessmentResponseSchema.safeParse(validResponse).success).toBe(true);
    const bad = structuredClone(validResponse) as Record<string, never> & typeof validResponse;
    bad.skills.reading.level = 'C2' as never;
    expect(AssessmentResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects too few / too many recommendations', () => {
    const one = { ...validResponse, recommendations: ['only one'] };
    expect(AssessmentResponseSchema.safeParse(one).success).toBe(false);
    const five = { ...validResponse, recommendations: Array(5).fill('rec') };
    expect(AssessmentResponseSchema.safeParse(five).success).toBe(false);
  });

  it('stored assessment survives the assessments.payload round-trip', () => {
    const stored: StoredAssessment = {
      ...validResponse,
      v: 1,
      model: 'anthropic/claude-sonnet-5',
      createdAt: 1_787_000_000_000,
      stats: { 'Total reviews completed': 65 },
    } as StoredAssessment;
    // payload column is JSON — simulate write + read.
    const roundTripped = JSON.parse(JSON.stringify(stored)) as unknown;
    expect(parseStoredAssessment(roundTripped)).toEqual(stored);
    expect(parseStoredAssessment({ v: 2 })).toBeNull();
  });

  it('fence-wrapped model output still parses via extractJsonObject', () => {
    const wrapped = '```json\n' + JSON.stringify(validResponse) + '\n```';
    const parsed = AssessmentResponseSchema.safeParse(extractJsonObject(wrapped));
    expect(parsed.success).toBe(true);
  });
});

describe('assessment prompt template', () => {
  it('system pins the JSON contract; user carries stats and journal', () => {
    const messages = buildAssessmentMessages({
      stats: { 'Total reviews completed': 65, 'Stories finished': 5 },
      journal: [
        { ru: 'Я читаю книгу.', corrected: 'Я читаю книгу.', createdAt: Date.UTC(2026, 7, 21) },
      ],
    });
    expect(messages[0]!.role).toBe('system');
    for (const key of [
      '"skills"',
      '"reading"',
      '"listening"',
      '"writing"',
      '"speaking"',
      '"recommendations"',
      '"summary"',
    ]) {
      expect(messages[0]!.content).toContain(key);
    }
    expect(messages[0]!.content).toContain('PROXY');
    const user = messages[1]!.content;
    expect(user).toContain('Total reviews completed: 65');
    expect(user).toContain('Я читаю книгу.');
    expect(user).toContain('AI-corrected version:');
    expect(user).toContain('2026-08-21');
  });

  it('renders the empty-journal placeholder', () => {
    const messages = buildAssessmentMessages({ stats: { X: 1 }, journal: [] });
    expect(messages[1]!.content).toContain('(no journal entries yet)');
  });
});

describe('auto cadence gate', () => {
  const at = (createdAt: number): StoredAssessment =>
    ({ ...validResponse, v: 1, model: 'm', createdAt }) as StoredAssessment;

  it('no assessments yet → assess', () => {
    expect(shouldAutoAssess([])).toBe(true);
  });

  it('fresh assessment → wait; stale → assess', () => {
    const now = 1_787_000_000_000;
    expect(shouldAutoAssess([at(now - AUTO_ASSESS_INTERVAL_MS + 1)], now)).toBe(false);
    expect(shouldAutoAssess([at(now - AUTO_ASSESS_INTERVAL_MS)], now)).toBe(true);
  });

  it('evidence gate: journal or ≥20 reviews', () => {
    expect(bundleHasEvidence({ stats: { 'Total reviews completed': 0 }, journal: [] })).toBe(false);
    expect(bundleHasEvidence({ stats: { 'Total reviews completed': 20 }, journal: [] })).toBe(true);
    expect(
      bundleHasEvidence({
        stats: { 'Total reviews completed': 0 },
        journal: [{ ru: 'Привет.', createdAt: 0 }],
      }),
    ).toBe(true);
  });
});
