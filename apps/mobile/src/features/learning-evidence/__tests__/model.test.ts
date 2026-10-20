import { describe, expect, it } from 'vitest';
import { resolveSkill, isHeldOut } from '../aliases';
import { PRACTICE, SKILL_IDS } from '../catalog';
import {
  classifiedEvidence,
  gradePractice,
  nextPractice,
  parsePracticeDetail,
  practiceEvidence,
  summarizeEvidence,
  type LearningEvidence,
  type PracticeDetail,
} from '../model';

const first = PRACTICE[0]!;
const detail: PracticeDetail = {
  v: 1,
  skill: first.skill,
  promptId: first.id,
  context: first.context,
  catalogVersion: 1,
  answer: first.answer,
  correct: true,
  assistance: 'none',
  exposure: 'first',
  grader: 'exact-match-v1',
};
const at = new Date(2026, 9, 20, 12).getTime();
const evidence = practiceEvidence('first', at, detail);

describe('skill evidence semantics', () => {
  it('has ten stable distinctions but maps only reviewed item-version aliases', () => {
    expect(SKILL_IDS).toHaveLength(10);
    expect(resolveSkill('a1-hotel-f07', 1, 'case-dat', 'u1-c01')).toBe('dative-verbs');
    expect(resolveSkill('a1-torfl-lexgram-001', 1, 'case-dat', 'lg-case-dat-01')).toBe(
      'dative-verbs',
    );
    expect(resolveSkill('a1-torfl-lexgram-001', 1, 'case-dat', 'lg-case-dat-15')).toBeNull(); // age, not a verb
    expect(resolveSkill('a1-torfl-lexgram-001', 1, 'case-acc', 'lg-case-acc-08')).toBeNull(); // object, not destination
    expect(resolveSkill('a1-hotel-f07', 2, 'case-dat', 'u1-c01')).toBeNull();
    expect(resolveSkill('new-pack', 1, 'case-dat', 'u1-c01')).toBeNull();
    expect(isHeldOut('a1-torfl-mock-004')).toBe(true);
    expect(isHeldOut('a1-hotel-f13')).toBe(true);
  });
  it('deduplicates event identity and never turns a repeated answer/context into fresh mastery', () => {
    const rows = [
      evidence,
      evidence,
      { ...evidence, id: 'again', at: at + 1 },
      { ...evidence, id: 'another-item', itemKey: 'different', at: at + 2 },
    ];
    const summary = summarizeEvidence(rows)[0]!;
    expect(summary.practiced).toBe(2);
    expect(summary.freshUnaided).toBe(1);
    expect(summary.repeatedSuccess).toBe(2);
  });
  it('unknown help/version, assisted and uncertain ASR success cannot inflate transfer', () => {
    const variations: LearningEvidence[] = [
      {
        ...evidence,
        id: 'old',
        itemKey: 'old',
        context: 'old',
        assistance: 'unknown',
        historicalVersion: null,
      },
      { ...evidence, id: 'hint', itemKey: 'hint', context: 'hint', assistance: 'help' },
      {
        ...evidence,
        id: 'asr',
        itemKey: 'asr',
        context: 'asr',
        grader: 'asr',
        result: 'incorrect',
      },
      {
        ...evidence,
        id: 'abandoned-before',
        itemKey: 'abandoned-before',
        context: 'abandoned-before',
        knownRepeat: true,
      },
    ];
    expect(classifiedEvidence(variations).some((e) => e.freshUnaided)).toBe(false);
    expect(summarizeEvidence(variations)[0]?.missedItems).toBe(0);
  });
  it('retains earlier misses when a repeated answer is later correct', () => {
    const rows = [
      { ...evidence, result: 'incorrect' as const },
      { ...evidence, id: 'later', at: at + 1 },
    ];
    expect(summarizeEvidence(rows)[0]).toMatchObject({
      missedItems: 1,
      freshUnaided: 0,
      repeatedSuccess: 1,
    });
  });
  it('changes context on the next local day, but same-day retry and abandoned exposure stay repeats', () => {
    expect(nextPractice(first.skill, [evidence], at + 1000)).toMatchObject({
      repeat: true,
      nextDay: true,
      prompt: { id: first.id },
    });
    const tomorrow = new Date(2026, 9, 21, 0, 1).getTime();
    const next = nextPractice(first.skill, [evidence], tomorrow);
    expect(next.prompt.context).not.toBe(first.context);
    expect(next.repeat).toBe(false);
    expect(
      nextPractice(first.skill, [], at + 1000, [
        { v: 1, kind: 'prompt', skill: first.skill, promptId: first.id, at },
      ]).repeat,
    ).toBe(true);
  });
  it('validates stored answers and exact endings, allowing accents/ё without fuzzy credit', () => {
    expect(parsePracticeDetail(detail)).toEqual(detail);
    expect(parsePracticeDetail({ ...detail, answer: 'кухне' })).toBeNull();
    expect(parsePracticeDetail({ ...detail, context: 'invented' })).toBeNull();
    expect(gradePractice(first, ' КУХНЮ. ')).toBe(true);
    expect(gradePractice(first, 'кухне')).toBe(false);
    const coat = PRACTICE.find((p) => p.id === 'agreement-coat-v1')!;
    expect(gradePractice(coat, 'теплое')).toBe(true);
    expect(gradePractice(coat, 'теплый')).toBe(false);
  });
  it('ships two distinct reviewed everyday contexts for each active skill', () => {
    for (const skill of ['location-destination', 'dative-verbs', 'adjective-agreement']) {
      const prompts = PRACTICE.filter((p) => p.skill === skill);
      expect(prompts).toHaveLength(2);
      expect(new Set(prompts.map((p) => p.context)).size).toBe(2);
      for (const prompt of prompts) expect(gradePractice(prompt, prompt.answer)).toBe(true);
    }
  });
});
