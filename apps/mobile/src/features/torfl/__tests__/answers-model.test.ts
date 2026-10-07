import { describe, expect, it } from 'vitest';

import {
  groupAnswers,
  isTorflPrompt,
  promptTopic,
  rehearsalText,
  rehearseHref,
  summarizeRehearsal,
  type AnswerEntry,
  type AnswerPrompt,
} from '../answers/answers-model';

/** T74 — «Мои ответы» pure model (TORFL §9). */

function prompt(
  id: string,
  tags: string[] | null,
  packId = 'a1-torfl-prompts-fixture',
): AnswerPrompt {
  return { packId, id, promptRu: `Вопрос ${id}`, promptEn: `Prompt ${id}`, tags };
}

function entry(
  id: string,
  promptId: string | null,
  createdAt: number,
  extra: Partial<AnswerEntry> = {},
): AnswerEntry {
  return {
    id,
    promptId,
    ru: 'Меня зовут Митч. Мне тридцать шесть лет.',
    aiFeedback: null,
    feedbackStatus: 'none',
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

describe('promptTopic / isTorflPrompt', () => {
  it('reads the torfl:<topic> slug and falls back to other', () => {
    expect(promptTopic(['torfl', 'torfl:speak-monologue'])).toBe('speak-monologue');
    expect(promptTopic(['torfl'])).toBe('other');
    expect(promptTopic(null)).toBe('other');
    expect(promptTopic(['torfl:'])).toBe('other');
  });

  it('a prompt is in the bank only with the torfl tag', () => {
    expect(isTorflPrompt(prompt('a', ['torfl', 'torfl:write-letter']))).toBe(true);
    expect(isTorflPrompt(prompt('b', ['torfl:write-letter']))).toBe(false);
    expect(isTorflPrompt(prompt('c', ['daily-life']))).toBe(false);
    expect(isTorflPrompt(prompt('d', null))).toBe(false);
  });
});

describe('groupAnswers', () => {
  const prompts = [
    prompt('tf-other-01', ['torfl']),
    prompt('tf-mono-01', ['torfl', 'torfl:speak-monologue']),
    prompt('tf-letter-01', ['torfl', 'torfl:write-letter']),
    prompt('tf-letter-02', ['torfl', 'torfl:write-letter']),
    prompt('tf-coined-01', ['torfl', 'torfl:zzz-new-topic']),
    prompt('moy-den', ['daily-life']),
  ];

  it('groups torfl prompts by topic in §3.4 order, unknown slugs after, other last; non-torfl dropped', () => {
    const groups = groupAnswers(prompts, []);
    expect(groups.map((g) => g.topic)).toEqual([
      'write-letter',
      'speak-monologue',
      'zzz-new-topic',
      'other',
    ]);
    expect(groups[0]!.labelRu).toBe('Письмо');
    expect(groups[2]!.labelRu).toBe('zzz-new-topic');
    expect(groups[3]!.labelRu).toBe('Другие темы');
    expect(groups[0]!.prompts.map((p) => p.prompt.id)).toEqual(['tf-letter-01', 'tf-letter-02']);
  });

  it('attaches entries to their prompt newest first and counts them per topic', () => {
    const entries = [
      entry('e1', 'tf-letter-01', 100),
      entry('e2', 'tf-letter-01', 300),
      entry('e3', 'tf-letter-02', 200),
      entry('e4', 'moy-den', 400),
      entry('e5', null, 500),
      entry('e6', 'unknown-prompt', 600),
    ];
    const groups = groupAnswers(prompts, entries);
    const letter = groups.find((g) => g.topic === 'write-letter')!;
    expect(letter.entryCount).toBe(3);
    expect(letter.prompts[0]!.entries.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(letter.prompts[1]!.entries.map((e) => e.id)).toEqual(['e3']);
    expect(groups.find((g) => g.topic === 'speak-monologue')!.entryCount).toBe(0);
  });

  it('no torfl prompts → empty', () => {
    expect(groupAnswers([prompt('moy-den', ['daily-life'])], [entry('e', 'moy-den', 1)])).toEqual(
      [],
    );
  });
});

describe('rehearsalText', () => {
  it("splits Mitch's own text into sentences when there is no feedback", () => {
    const t = rehearsalText(entry('e', null, 1));
    expect(t).toEqual({
      sentences: ['Меня зовут Митч.', 'Мне тридцать шесть лет.'],
      corrected: false,
    });
  });

  it('prefers the stored AI correction and says so', () => {
    const aiFeedback = JSON.stringify({
      v: 1,
      sourceRu: 'Я живу в Колорадо уже тринадцать год.',
      model: 'anthropic/claude-opus-5.5',
      createdAt: 1,
      corrected: 'Я живу в Колорадо уже тринадцать лет. Моя невеста Алина — украинка!',
      changes: [],
      summary: 'Хорошо.',
    });
    const t = rehearsalText(
      entry('e', null, 1, { ru: 'Я живу в Колорадо уже тринадцать год.', aiFeedback }),
    );
    expect(t.corrected).toBe(true);
    expect(t.sentences).toEqual([
      'Я живу в Колорадо уже тринадцать лет.',
      'Моя невеста Алина — украинка!',
    ]);
  });

  it('unreadable feedback falls back to the entry; empty text → no sentences', () => {
    expect(rehearsalText(entry('e', null, 1, { aiFeedback: '{not json' })).corrected).toBe(false);
    expect(rehearsalText(entry('e', null, 1, { ru: '   \n ' })).sentences).toEqual([]);
  });
});

describe('summarizeRehearsal', () => {
  it('averages each pass to one decimal, reports recall as the score, lists weak sentences worst-first', () => {
    const s = summarizeRehearsal(
      [
        { index: 0, score: 100 },
        { index: 1, score: 67 },
        { index: 2, score: 90 },
      ],
      [
        { index: 0, score: 50 },
        { index: 1, score: 100 },
        { index: 2, score: 85 },
      ],
    );
    expect(s.withText).toBe(85.7);
    expect(s.withoutText).toBe(78.3);
    expect(s.score).toBe(78);
    expect(s.weakest).toEqual([0, 1]);
  });

  it('a single pass scores itself; nothing recorded → 0 with no weak lines', () => {
    expect(summarizeRehearsal([{ index: 0, score: 80 }], [])).toMatchObject({
      withText: 80,
      withoutText: null,
      score: 80,
      weakest: [],
    });
    expect(summarizeRehearsal([], [])).toEqual({
      withText: null,
      withoutText: null,
      score: 0,
      weakest: [],
    });
  });
});

describe('rehearseHref', () => {
  it('carries the entry id and topic slug only — never text', () => {
    expect(rehearseHref('abc', 'write-letter')).toEqual({
      pathname: '/torfl/rehearse',
      params: { entryId: 'abc', topic: 'write-letter' },
    });
  });
});
