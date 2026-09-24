import { describe, expect, it } from 'vitest';

import {
  renderCatalogForPrompt,
  renderCatalogLine,
  SECTION_CATALOG,
} from '@/features/word-forms/profile-core';

import {
  buildWordProfileCorrectionMessages,
  buildWordProfileMessages,
  buildWordProfileSystem,
  buildWordProfileUserTurn,
  LANGUAGE_NAMES,
} from '../prompts/word-profile';

describe('word-profile prompt (§6.1)', () => {
  it('system prompt: verbatim hard rules + contract, placeholders resolved, catalog rendered from SECTION_CATALOG one-to-one', () => {
    const system = buildWordProfileSystem('ru');
    expect(system.startsWith('You are an expert Russian morphologist and language teacher.')).toBe(
      true,
    );
    expect(system).not.toMatch(/\{LANGUAGE_NAME\}|\{LANGUAGE_CODE\}|\{CATALOG_RENDERED/);
    expect(system).toContain('"language": "ru"');
    for (const needle of [
      'Hard rules',
      '1. Every Russian form appears twice: "ru" WITH stress marks and "plain" WITHOUT.',
      'combining acute accent U+0301',
      '2. Never invent a form.',
      '3. Include ONLY the sections that apply to the part of speech, in the catalog order',
      'You may add extra sections only with an id starting "x-".',
      '5. If the headword is a homograph (за́мок / замо́к)',
      '6. For verbs, the family section lists the aspect partner first',
      'at most 14 rows in total',
      '8. Keep the whole object under ~6 000 tokens.',
      'Contract (TypeScript-ish):',
      '"pos": "verb"|"noun"|"adj"|"adv"|"pron"|"num"|"prep"|"conj"|"part"|"name"|"phrase"|"other"',
      'Overview facts to include when applicable:',
      'Section catalog (FIXED labels must be copied verbatim):',
    ]) {
      expect(system, needle).toContain(needle);
    }
    // The catalog block IS renderCatalogForPrompt — one line per SECTION_CATALOG entry, in order.
    const block = system.split('Section catalog (FIXED labels must be copied verbatim):\n')[1]!;
    expect(block).toBe(renderCatalogForPrompt('ru'));
    const lines = block.split('\n');
    expect(lines).toHaveLength(SECTION_CATALOG.length);
    SECTION_CATALOG.forEach((entry, i) => {
      expect(lines[i]).toBe(renderCatalogLine(entry, 'ru'));
      expect(lines[i]).toContain(`id "${entry.id}"`);
    });
  });

  it('Ukrainian render swaps the language name/code and carries the vocative row', () => {
    const system = buildWordProfileSystem('uk');
    expect(system).toContain('expert Ukrainian morphologist');
    expect(system).toContain('"language": "uk"');
    expect(system).toContain('Voc. — кличний');
    expect(LANGUAGE_NAMES).toEqual({ ru: 'Russian', uk: 'Ukrainian' });
  });

  it('user turn: every line when everything is present, in the design order', () => {
    const turn = buildWordProfileUserTurn({
      language: 'ru',
      kind: 'word',
      headword: 'говорить',
      surface: 'говорил',
      translation: 'to speak',
      grammar: 'past, masc.',
      pos: 'verb',
      level: 'A1',
      contexts: ['Он говорил тихо.', 'Не говори никому.'],
    });
    expect(turn.split('\n')).toEqual([
      'Profile this Russian word: «говорить»',
      'Saved translation: "to speak"',
      'First met as the form «говорил»',
      'Saved grammar note about that form: past, masc.',
      'Saved part of speech: verb',
      'CEFR tag: A1',
      'Sentences I met it in:',
      '- «Он говорил тихо.»',
      '- «Не говори никому.»',
      'Return the JSON object only.',
    ]);
  });

  it('user turn: empty fields are omitted cleanly; surface line only for words when ≠ headword', () => {
    expect(
      buildWordProfileUserTurn({
        language: 'ru',
        kind: 'phrase',
        headword: 'волосы встали дыбом',
        surface: 'Волосы встали дыбом',
        translation: '',
        grammar: null,
        contexts: ['  ', ''],
      }).split('\n'),
    ).toEqual([
      'Profile this Russian phrase: «волосы встали дыбом»',
      'Return the JSON object only.',
    ]);
    expect(
      buildWordProfileUserTurn({ language: 'ru', kind: 'word', headword: 'окно', surface: 'окно' }),
    ).not.toContain('First met as');
    expect(
      buildWordProfileUserTurn({ language: 'ru', kind: 'word', headword: 'окно', surface: 'окна' }),
    ).toContain('First met as the form «окна»');
  });

  it('messages = [system, user]; the correction round appends the raw answer + the verbatim issues', () => {
    const first = buildWordProfileMessages({ language: 'ru', kind: 'word', headword: 'окно' });
    expect(first.map((m) => m.role)).toEqual(['system', 'user']);
    const fix = buildWordProfileCorrectionMessages(first, '{"v":1,"bad":true}', [
      'sections[0].grid.cells[4]: expected 2 columns, got 3',
      'headword.plain: must equal ru with every U+0301 removed (got "окн")',
    ]);
    expect(fix).toHaveLength(4);
    expect(fix.slice(0, 2)).toEqual(first);
    expect(fix[2]).toEqual({ role: 'assistant', content: '{"v":1,"bad":true}' });
    expect(fix[3]!.role).toBe('user');
    expect(fix[3]!.content.split('\n')).toEqual([
      'Your JSON failed validation. Fix ONLY these issues and return the complete corrected JSON:',
      '- sections[0].grid.cells[4]: expected 2 columns, got 3',
      '- headword.plain: must equal ru with every U+0301 removed (got "окн")',
    ]);
  });
});
