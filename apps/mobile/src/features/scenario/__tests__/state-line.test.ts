import { describe, expect, it } from 'vitest';

import { initialState, type TurnState } from '../engine/turn-machine';
import { stateLineText } from '../stage/state-line-text';

import { graph } from './engine-fixtures';

/** The state line never shows a transcript (T62 §9.3) — only what is happening. */
const base = initialState(graph);
const withPhase = (phase: TurnState['phase']): TurnState => ({
  ...base,
  phase,
  lastTranscript: 'меня зовут митч',
});

describe('stateLineText', () => {
  it('names the phase, never the transcript', () => {
    const cases: [TurnState['phase'], string][] = [
      [{ kind: 'intro' }, ''],
      [{ kind: 'saying', lineIdx: 0 }, 'Кирилл говорит…'],
      [{ kind: 'listening', recording: 'idle' }, 'Твоя очередь — нажми и говори'],
      [{ kind: 'listening', recording: 'tap' }, 'Слушаю…'],
      [{ kind: 'listening', recording: 'hold' }, 'Слушаю…'],
      [{ kind: 'deciding', stage: 'transcribing' }, 'Думаю…'],
      [{ kind: 'deciding', stage: 'rescuing' }, 'Думаю…'],
      [{ kind: 'reacting', reaction: 'confused', queue: [], idx: 0 }, 'Кирилл переспрашивает…'],
      [{ kind: 'reacting', reaction: 'react', queue: [], idx: 0 }, 'Кирилл переспрашивает…'],
      [{ kind: 'reacting', reaction: 'hint', queue: [], idx: 0 }, 'Кирилл подсказывает…'],
      [{ kind: 'reacting', reaction: 'slower', queue: [], idx: 0 }, 'Кирилл повторяет…'],
      [{ kind: 'reacting', reaction: 'explain', queue: [], idx: 0 }, 'Кирилл объясняет…'],
      [{ kind: 'reacting', reaction: 'silence', queue: [], idx: 0 }, 'Кирилл говорит…'],
      [{ kind: 'ending', endingId: 'end-ok' }, ''],
      [{ kind: 'paused', resume: { kind: 'intro' } }, 'Пауза'],
    ];
    for (const [phase, expected] of cases) {
      const text = stateLineText(withPhase(phase), 'Кирилл');
      expect(text).toBe(expected);
      expect(text).not.toContain('митч');
    }
  });
});
