import type { ScenarioTurnRuntime } from '@/db/repositories/scenarios';

import type { JudgeResult } from '../judge/judge';
import type { EngineGraph } from '../engine/turn-machine';

/**
 * The fixture pack's graph («Проверка связи», `a1-scenario-fixture`,
 * scenario `radio-a1`) in T58's runtime shape, plus judge-result builders.
 */

const turns: ScenarioTurnRuntime[] = [
  {
    id: 'radio-a1-t01',
    orderIdx: 0,
    speakerId: 'host',
    say: ['radio-a1-t01-a', 'radio-a1-t01-b', 'radio-a1-t01'],
    expect: null,
    retry: null,
    next: 'radio-a1-t02',
    endingId: null,
  },
  {
    id: 'radio-a1-t02',
    orderIdx: 1,
    speakerId: 'host',
    say: ['radio-a1-t02-a', 'radio-a1-t02'],
    expect: {
      slots: [{ kind: 'free', id: 'name', required: true, minTokens: 1 }],
      accept: ['Меня зовут Митч.', 'Я Митч.'],
      reject: [{ forms: ['хорошо', 'спасибо'], reactSentenceId: 'radio-a1-t02-react' }],
    },
    retry: {
      confused: 'radio-a1-t02-confused',
      hint: 'radio-a1-t02-hint',
      second: 'radio-a1-t02-second',
      lifeline: { ru: '«Меня зовут …».', en: '"Меня зовут …" (My name is …).' },
    },
    next: 'radio-a1-t03',
    endingId: null,
  },
  {
    id: 'radio-a1-t03',
    orderIdx: 2,
    speakerId: 'host',
    say: ['radio-a1-t03'],
    expect: {
      slots: [
        {
          kind: 'forms',
          id: 'mood',
          required: true,
          acceptsNumber: false,
          options: [
            { key: 'good', lemma: 'хорошо', forms: ['хорошо', 'отлично'] },
            { key: 'bad', lemma: 'плохо', forms: ['плохо', 'устал*'] },
            { key: 'ok', lemma: 'ничего', forms: ['ничего'] },
          ],
        },
      ],
      accept: ['Хорошо, спасибо.', 'Плохо, я устал.', 'Ничего.'],
      branchOn: 'mood',
    },
    retry: {
      confused: 'radio-a1-t03-confused',
      hint: 'radio-a1-t03-hint',
      lifeline: { ru: '«Хорошо, спасибо» / «Плохо, я устал».', en: '…' },
    },
    next: { on: { good: 'radio-a1-t04g', bad: 'radio-a1-t04b' }, default: 'radio-a1-t04d' },
    endingId: null,
  },
  ...(['g', 'b', 'd'] as const).map((suffix, i): ScenarioTurnRuntime => ({
    id: `radio-a1-t04${suffix}`,
    orderIdx: 3 + i,
    speakerId: 'host',
    say: [`radio-a1-t04${suffix}-a`, `radio-a1-t04${suffix}`],
    expect: null,
    retry: null,
    next: null,
    endingId: 'end-ok',
  })),
];

export const graph: EngineGraph = {
  scenarioId: 'radio-a1',
  startTurnId: 'radio-a1-t01',
  turns,
  nudges: [
    { kind: 'silence', sentenceId: 'radio-a1-nudge-silence' },
    { kind: 'which-word', sentenceId: 'radio-a1-nudge-which-word' },
    { kind: 'dont-know', sentenceId: 'radio-a1-nudge-dont-know' },
  ],
  glossaryClips: {
    'radio-a1-gl-connection': {
      explain: 'radio-a1-gl-connection-explain',
      howToSay: 'radio-a1-gl-connection-howtosay',
    },
  },
};

export function judgeResult(over: Partial<JudgeResult> = {}): JudgeResult {
  return {
    verdict: 'matched',
    branchKey: null,
    slots: {},
    slotResults: [],
    score: 100,
    target: 'Меня зовут Митч.',
    words: [],
    nearMiss: false,
    rejectIndex: null,
    matchedBy: 'slots',
    tokenCount: 3,
    contentTokenCount: 2,
    ...over,
  };
}

export const missResult = (over: Partial<JudgeResult> = {}) =>
  judgeResult({ verdict: 'miss', matchedBy: null, score: 0, ...over });
