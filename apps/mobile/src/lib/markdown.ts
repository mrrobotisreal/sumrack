/**
 * Minimal markdown model for study notes (T15, design §7.4) — deliberately
 * small: headings (#/##/###), paragraphs, unordered/ordered lists,
 * blockquotes, fenced code blocks, inline code/bold/italic spans, and
 * horizontal rules. Pure functions, no deps — unit-tested, shared by the
 * notes preview now and T17's grammar-lesson renderer later.
 *
 * Inline content parses to styled runs (not a tree): flat runs are what the
 * selectable free-text layer consumes, so the notes preview can host the
 * highlight-to-bank gesture on real styled text.
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list-item'; ordered: boolean; marker: string; runs: InlineRun[] }
  | { kind: 'quote'; runs: InlineRun[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: InlineRun[][][]; headerRow: boolean }
  | { kind: 'hr' };

/** Split a `| a | b |` table line into trimmed cells (`\|` escapes honored). */
function splitTableCells(line: string): string[] {
  const ESC = '\u0000';
  const inner = line
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .replaceAll('\\|', ESC);
  return inner.split('|').map((c) => c.replaceAll(ESC, '|').trim());
}

/** True for the `| --- | :--: |` separator row under a table header. */
function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** Parse inline markup into flat styled runs. Unclosed markers render literally. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Longest markers first so ** never half-matches as two *.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last) runs.push({ text: text.slice(last, start) });
    const [, code, bold, star, underscore] = match;
    if (code) runs.push({ text: code.slice(1, -1), code: true });
    else if (bold) runs.push({ text: bold.slice(2, -2), bold: true });
    else if (star) runs.push({ text: star.slice(1, -1), italic: true });
    else if (underscore) runs.push({ text: underscore.slice(1, -1), italic: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

/** Parse a markdown document into blocks. Never throws — bad input is just text. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  let inCode = false;
  let codeLines: string[] = [];
  let tableRows: string[][] = [];
  let tableHasSeparator = false;
  const flushTable = () => {
    if (tableRows.length === 0) return;
    blocks.push({
      kind: 'table',
      rows: tableRows.map((cells) => cells.map(parseInline)),
      headerRow: tableHasSeparator,
    });
    tableRows = [];
    tableHasSeparator = false;
  };

  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) {
        blocks.push({ kind: 'code', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    // GFM-style table rows: | a | b | (a run of them forms one table block;
    // the --- separator row is swallowed and marks row 1 as the header).
    if (/^\|.*\|?$/.test(trimmed) && trimmed.length > 1) {
      const cells = splitTableCells(trimmed);
      if (isTableSeparator(cells)) {
        if (tableRows.length > 0) tableHasSeparator = true;
        continue;
      }
      flushParagraph();
      tableRows.push(cells);
      continue;
    }
    flushTable();
    if (/^```/.test(trimmed)) {
      flushParagraph();
      inCode = true;
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        runs: parseInline(heading[2]!),
      });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      blocks.push({
        kind: 'list-item',
        ordered: false,
        marker: '•',
        runs: parseInline(unordered[1]!),
      });
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      blocks.push({
        kind: 'list-item',
        ordered: true,
        marker: `${ordered[1]}.`,
        runs: parseInline(ordered[2]!),
      });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', runs: parseInline(quote[1]!) });
      continue;
    }
    paragraph.push(trimmed);
  }
  // EOF inside a fence: treat the collected lines as code anyway.
  if (inCode && codeLines.length > 0) blocks.push({ kind: 'code', text: codeLines.join('\n') });
  flushTable();
  flushParagraph();
  return blocks;
}
