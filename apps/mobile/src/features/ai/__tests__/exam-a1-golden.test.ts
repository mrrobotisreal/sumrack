import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildExamSpeakingMessages } from '../prompts/exam-speaking';
import { buildExamWritingMessages } from '../prompts/exam-writing';

/**
 * T76: the A1 exam prompts are BYTE-IDENTICAL to what T72 / T73 shipped. The golden file was generated from
 * the pre-T76 prompt builders over the captured A1 inputs; adding `level` must not change A1 output —
 * with `level` absent AND with `level: 'A1'`.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const golden = JSON.parse(
  readFileSync(path.join(FIXTURES, 'a1-prompts.golden.json'), 'utf8'),
) as Record<string, unknown>;
const input = (name: string) =>
  (JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as { input: never }).input;

describe('A1 exam prompts are byte-identical after the level split (T76)', () => {
  for (const name of ['exam-writing-good-claude', 'exam-writing-weak-claude']) {
    it(name, () => {
      const i = input(name);
      expect(JSON.stringify(buildExamWritingMessages(i))).toBe(JSON.stringify(golden[name]));
      expect(
        JSON.stringify(buildExamWritingMessages({ ...(i as object), level: 'A1' } as never)),
      ).toBe(JSON.stringify(golden[name]));
    });
  }
  for (const name of ['exam-speaking-reply-claude', 'exam-speaking-monologue-claude']) {
    it(name, () => {
      const i = input(name);
      expect(JSON.stringify(buildExamSpeakingMessages(i))).toBe(JSON.stringify(golden[name]));
      expect(
        JSON.stringify(buildExamSpeakingMessages({ ...(i as object), level: 'A1' } as never)),
      ).toBe(JSON.stringify(golden[name]));
    });
  }
});

describe('A2 exam prompts carry the A2 standard (T76)', () => {
  const w = input('exam-writing-good-claude');
  it('writing letter: A2 header + the control-sheet mapping, same JSON contract', () => {
    const sys = buildExamWritingMessages({
      ...(w as object),
      level: 'A2',
      taskTopic: 'write-letter',
    } as never)[0]!.content;
    expect(sys).toContain('A2 / Basic level (ТБУ)');
    expect(sys).toContain('control sheet');
    expect(sys).not.toContain('HONEST A1');
    expect(sys).toContain('"id": "letter-form", "score": <0-10>, "max": 10');
    expect(sys).toContain('"id": "grammar", "score": <0-25>, "max": 25');
    expect(sys).toContain('LETTER to a friend');
  });
  it('writing note: the messenger rubric, per-unit completeness, greeting OR sign-off', () => {
    const msgs = buildExamWritingMessages({
      ...(w as object),
      level: 'A2',
      taskTopic: 'write-note',
      letter: 'Привет!',
    } as never);
    expect(msgs[0]!.content).toContain('MESSENGER MESSAGE');
    expect(msgs[0]!.content).toContain('greeting OR a sign-off');
    expect(msgs[1]!.content).toContain("THE CANDIDATE'S MESSAGE:");
  });
  it('speaking: A2 turn + monologue standards (12 phrases floor)', () => {
    const r = input('exam-speaking-reply-claude');
    const m = input('exam-speaking-monologue-claude');
    expect(
      buildExamSpeakingMessages({ ...(r as object), level: 'A2' } as never)[0]!.content,
    ).toContain('A2 / Basic level (ТБУ)');
    const mono = buildExamSpeakingMessages({
      ...(m as object),
      level: 'A2',
      minSentences: undefined,
      maxSentences: undefined,
    } as never);
    expect(mono[0]!.content).toContain('prepared for 10 minutes');
    expect(mono[0]!.content).toContain('fewer than 12 phrases');
    expect(mono[1]!.content).toContain('Required: 12–15 sentences.');
  });
});
