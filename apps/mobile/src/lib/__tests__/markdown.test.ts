import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '../markdown';

describe('parseInline', () => {
  it('plain text is one run', () => {
    expect(parseInline('привет мир')).toEqual([{ text: 'привет мир' }]);
  });

  it('bold, italic, and code runs', () => {
    expect(parseInline('это **жирный** и *курсив* и `код`')).toEqual([
      { text: 'это ' },
      { text: 'жирный', bold: true },
      { text: ' и ' },
      { text: 'курсив', italic: true },
      { text: ' и ' },
      { text: 'код', code: true },
    ]);
  });

  it('underscore italics', () => {
    expect(parseInline('_тихо_')).toEqual([{ text: 'тихо', italic: true }]);
  });

  it('unclosed markers render literally', () => {
    expect(parseInline('2 * 3 равно 6')).toEqual([{ text: '2 * 3 равно 6' }]);
    expect(parseInline('**не закрыто')).toEqual([{ text: '**не закрыто' }]);
  });

  it('** never half-matches as two *', () => {
    expect(parseInline('**оба**')).toEqual([{ text: 'оба', bold: true }]);
  });
});

describe('parseMarkdown', () => {
  it('headings levels 1–3', () => {
    const blocks = parseMarkdown('# Раз\n## Два\n### Три');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, runs: [{ text: 'Раз' }] },
      { kind: 'heading', level: 2, runs: [{ text: 'Два' }] },
      { kind: 'heading', level: 3, runs: [{ text: 'Три' }] },
    ]);
  });

  it('paragraph lines join on single newlines, split on blank lines', () => {
    const blocks = parseMarkdown('первая строка\nвторая строка\n\nновый абзац');
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'первая строка вторая строка' }] },
      { kind: 'paragraph', runs: [{ text: 'новый абзац' }] },
    ]);
  });

  it('unordered and ordered lists', () => {
    const blocks = parseMarkdown('- один\n* два\n1. первый\n2) второй');
    expect(blocks).toEqual([
      { kind: 'list-item', ordered: false, marker: '•', runs: [{ text: 'один' }] },
      { kind: 'list-item', ordered: false, marker: '•', runs: [{ text: 'два' }] },
      { kind: 'list-item', ordered: true, marker: '1.', runs: [{ text: 'первый' }] },
      { kind: 'list-item', ordered: true, marker: '2.', runs: [{ text: 'второй' }] },
    ]);
  });

  it('blockquote and hr', () => {
    const blocks = parseMarkdown('> тишина\n\n---');
    expect(blocks).toEqual([{ kind: 'quote', runs: [{ text: 'тишина' }] }, { kind: 'hr' }]);
  });

  it('fenced code blocks keep their lines verbatim', () => {
    const blocks = parseMarkdown('```\nродительный падеж\n  - кого? чего?\n```\nдальше');
    expect(blocks).toEqual([
      { kind: 'code', text: 'родительный падеж\n  - кого? чего?' },
      { kind: 'paragraph', runs: [{ text: 'дальше' }] },
    ]);
  });

  it('unterminated fence still emits the code collected so far', () => {
    const blocks = parseMarkdown('```\nоборванный код');
    expect(blocks).toEqual([{ kind: 'code', text: 'оборванный код' }]);
  });

  it('inline markup inside a list item', () => {
    const blocks = parseMarkdown('- **важно**: слушать');
    expect(blocks).toEqual([
      {
        kind: 'list-item',
        ordered: false,
        marker: '•',
        runs: [{ text: 'важно', bold: true }, { text: ': слушать' }],
      },
    ]);
  });

  it('CRLF input parses the same as LF', () => {
    expect(parseMarkdown('# Раз\r\nтекст')).toEqual(parseMarkdown('# Раз\nтекст'));
  });

  it('empty input yields no blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});

describe('parseMarkdown — tables (T17 lesson renderer)', () => {
  it('parses a GFM table with header separator into one table block', () => {
    const blocks = parseMarkdown(
      ['| Form | Где? |', '| --- | --- |', '| дом | в дом**е** |', '| шкаф | в шкафу |'].join('\n'),
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0]!;
    if (table.kind !== 'table') throw new Error('expected table');
    expect(table.headerRow).toBe(true);
    expect(table.rows).toHaveLength(3); // separator swallowed
    expect(table.rows[0]![0]![0]!.text).toBe('Form');
    // inline markup inside cells still parses
    expect(table.rows[1]![1]!.some((r) => r.bold)).toBe(true);
  });

  it('a table without separator has no header row; escaped pipes stay literal', () => {
    const blocks = parseMarkdown('| a \\| b | c |\n| d | e |');
    const table = blocks[0]!;
    if (table.kind !== 'table') throw new Error('expected table');
    expect(table.headerRow).toBe(false);
    expect(table.rows[0]![0]![0]!.text).toBe('a | b');
  });

  it('tables end at blank lines and mix with paragraphs', () => {
    const blocks = parseMarkdown('before\n\n| a | b |\n\nafter');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
  });
});
