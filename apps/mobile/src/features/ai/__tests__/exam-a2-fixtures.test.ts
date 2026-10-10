import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { criteriaPercent } from '../../torfl/grading/writing';
import { speakingCriteriaPercent } from '../../torfl/grading/speaking';
import { buildExamSpeakingMessages, type ExamSpeakingInput } from '../prompts/exam-speaking';
import { buildExamWritingMessages, type ExamWritingInput } from '../prompts/exam-writing';
import { parseExamGrade } from '../schemas';

/**
 * T76: the ten captured A2 grading fixtures (letter strong / weak, note, reply, monologue x Opus 5.5 @ high
 * + GPT-6 Sol Pro @ high), captured on the S25 through the app's own AI path (`/dev-exam-capture`).
 * Parsed with the production parser; the stored input must still produce the A2 prompt.
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
interface Fx {
  input: ExamWritingInput & ExamSpeakingInput;
  model: string;
  choices: { message: { content: string } }[];
  usage: { cost?: number } | null;
}
const load = (n: string) => JSON.parse(readFileSync(path.join(DIR, `${n}.json`), 'utf8')) as Fx;

const WRITING = ['letter-strong', 'letter-weak', 'note'] as const;
const SPEAKING = ['reply', 'monologue'] as const;
const TAGS = ['claude', 'gpt'] as const;
const pct = (kind: 'writing' | 'speaking', name: string, tag: string) => {
  const g = parseExamGrade(load(`exam-${kind}-a2-${name}-${tag}`).choices[0]!.message.content)!;
  return kind === 'writing' ? criteriaPercent(g.criteria) : speakingCriteriaPercent(g.criteria);
};

describe('A2 exam grading fixtures (T76)', () => {
  for (const tag of TAGS) {
    for (const name of WRITING) {
      it(`writing ${name} / ${tag} validates and the prompt is A2`, () => {
        const fx = load(`exam-writing-a2-${name}-${tag}`);
        expect(parseExamGrade(fx.choices[0]!.message.content)).not.toBeNull();
        expect(fx.input.level).toBe('A2');
        expect(buildExamWritingMessages(fx.input)[0]!.content).toContain('A2 / Basic level');
        expect(fx.usage?.cost).toBeGreaterThan(0);
      });
    }
    for (const name of SPEAKING) {
      it(`speaking ${name} / ${tag} validates and the prompt is A2`, () => {
        const fx = load(`exam-speaking-a2-${name}-${tag}`);
        const g = parseExamGrade(fx.choices[0]!.message.content)!;
        expect(g).not.toBeNull();
        expect(g.criteria.map((c) => c.id)).toEqual(
          name === 'reply'
            ? ['task-response', 'completeness', 'grammar']
            : ['coverage', 'length', 'fluency', 'lexis-grammar'],
        );
        expect(buildExamSpeakingMessages(fx.input)[0]!.content).toContain('A2 / Basic level');
      });
    }
  }

  it('both graders rank strong > weak, and agree within 20 points', () => {
    for (const tag of TAGS) {
      expect(pct('writing', 'letter-strong', tag)).toBeGreaterThan(
        pct('writing', 'letter-weak', tag) + 30,
      );
    }
    for (const name of WRITING) {
      expect(Math.abs(pct('writing', name, 'claude') - pct('writing', name, 'gpt'))).toBeLessThan(
        20,
      );
    }
  });
});
