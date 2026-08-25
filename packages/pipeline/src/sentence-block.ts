import type { DraftIssue } from './errors.ts';

/**
 * The sentence-block grammar shared by story drafts (T08) and dialogue drafts
 * (T25): `RU:` / `EN:` / optional `GRAMMAR:` lines followed by the 7-column
 * token table. Extracted from `draft.ts` so the dialogue draft parser reuses
 * the exact same grammar (per the T25 ticket: reuse, never fork) — node lines
 * and choice lines are annotated with the identical table format as story
 * sentences.
 */

/** One row of a sentence's token annotation table, as authored. */
export interface DraftTokenRow {
  /** 1-based line number of this row in the draft file. */
  line: number;
  /** Surface form (NFC-normalized, ё preserved). */
  text: string;
  lemma?: string;
  translation?: string;
  pos?: string;
  grammar?: string;
  /** CEFR level cell, unvalidated here (checked during assembly). */
  level?: string;
  note?: string;
}

/** One parsed sentence block (a `## sentence-id` story block, a dialogue node line, or a choice line). */
export interface DraftSentence {
  /** 1-based line number of the heading that opened this block. */
  line: number;
  id: string;
  ru: string;
  /** Line the RU: text sits on (alignment errors point here). */
  ruLine: number;
  en: string;
  grammarTopics?: string[];
  rows: DraftTokenRow[];
}

/** The token table's required header, in order. */
export const TABLE_COLUMNS = [
  'text',
  'lemma',
  'translation',
  'pos',
  'grammar',
  'level',
  'note',
] as const;

/** Split a `| a | b |` table line into trimmed cells, honoring `\|` escapes. */
export function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  const ESC = '\u0000'; // sentinel: never appears in draft text
  const inner = trimmed.slice(1, -1).replaceAll('\\|', ESC);
  return inner.split('|').map((cell) => cell.replaceAll(ESC, '|').trim());
}

/** True for the `| --- | --- |` separator row under a table header. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c));
}

const KEY_LINE = /^(RU|EN|GRAMMAR):\s*(.*)$/;

/**
 * Accumulates one sentence block line by line. The owning parser feeds it
 * every line it does not recognize itself; `tryLine` returns whether the line
 * belonged to the sentence grammar (RU/EN/GRAMMAR or a table row). Call
 * `finish()` when the block closes — it pushes completeness issues and
 * returns the collected sentence.
 */
export class SentenceBlockCollector {
  readonly sentence: DraftSentence;
  private sawHeader = false;
  private sawSeparator = false;

  constructor(
    private readonly file: string,
    private readonly issues: DraftIssue[],
    headingLine: number,
    id: string,
    /** How error messages name this block: 'sentence "x"', 'node "x"', 'choice "x"'. */
    private readonly describe: string,
  ) {
    this.sentence = { line: headingLine, id, ru: '', ruLine: headingLine, en: '', rows: [] };
  }

  /** Try to consume one body line as part of this sentence block. */
  tryLine(raw: string, line: string, lineNo: number): boolean {
    const key = KEY_LINE.exec(line);
    if (key) {
      const value = key[2]!.trim().normalize('NFC');
      if (this.sawHeader) {
        this.issues.push({
          file: this.file,
          line: lineNo,
          message: `${key[1]}: line must come before the token table`,
        });
        return true;
      }
      if (key[1] === 'RU') {
        if (this.sentence.ru !== '')
          this.issues.push({ file: this.file, line: lineNo, message: 'duplicate RU: line' });
        if (value === '')
          this.issues.push({ file: this.file, line: lineNo, message: 'RU: line is empty' });
        this.sentence.ru = value;
        this.sentence.ruLine = lineNo;
      } else if (key[1] === 'EN') {
        if (this.sentence.en !== '')
          this.issues.push({ file: this.file, line: lineNo, message: 'duplicate EN: line' });
        if (value === '')
          this.issues.push({ file: this.file, line: lineNo, message: 'EN: line is empty' });
        this.sentence.en = value;
      } else {
        const topics = value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== '');
        if (topics.length === 0) {
          this.issues.push({
            file: this.file,
            line: lineNo,
            message: 'GRAMMAR: line has no topics',
          });
        }
        this.sentence.grammarTopics = topics;
      }
      return true;
    }

    const cells = splitTableRow(raw);
    if (cells) {
      if (!this.sawHeader) {
        const expected = TABLE_COLUMNS.join(', ');
        const got = cells.map((c) => c.toLowerCase());
        if (got.length !== TABLE_COLUMNS.length || got.some((c, k) => c !== TABLE_COLUMNS[k])) {
          this.issues.push({
            file: this.file,
            line: lineNo,
            message: `token table header must be exactly: ${expected} (got: ${cells.join(', ')})`,
          });
        }
        this.sawHeader = true;
        return true;
      }
      if (!this.sawSeparator) {
        if (!isSeparatorRow(cells)) {
          this.issues.push({
            file: this.file,
            line: lineNo,
            message: 'expected the "| --- |" separator row under the table header',
          });
        }
        this.sawSeparator = true;
        return true;
      }
      if (cells.length !== TABLE_COLUMNS.length) {
        this.issues.push({
          file: this.file,
          line: lineNo,
          message: `token row has ${cells.length} cells, expected ${TABLE_COLUMNS.length} (text, lemma, translation, pos, grammar, level, note)`,
        });
        return true;
      }
      const norm = (c: string | undefined): string | undefined => {
        const v = (c ?? '').normalize('NFC');
        return v === '' ? undefined : v;
      };
      const text = norm(cells[0]);
      if (text === undefined) {
        this.issues.push({
          file: this.file,
          line: lineNo,
          message: 'token row has an empty "text" cell',
        });
        return true;
      }
      this.sentence.rows.push({
        line: lineNo,
        text,
        lemma: norm(cells[1]),
        translation: norm(cells[2]),
        pos: norm(cells[3]),
        grammar: norm(cells[4]),
        level: norm(cells[5]),
        note: norm(cells[6]),
      });
      return true;
    }

    return false;
  }

  /** Close the block: push completeness issues, return the collected sentence. */
  finish(): DraftSentence {
    if (this.sentence.ru === '') {
      this.issues.push({
        file: this.file,
        line: this.sentence.line,
        message: `${this.describe} has no RU: line`,
      });
    }
    if (this.sentence.en === '') {
      this.issues.push({
        file: this.file,
        line: this.sentence.line,
        message: `${this.describe} has no EN: line`,
      });
    }
    if (!this.sawHeader || this.sentence.rows.length === 0) {
      this.issues.push({
        file: this.file,
        line: this.sentence.line,
        message: `${this.describe} has no token table (header row + at least one token row required)`,
      });
    }
    return this.sentence;
  }
}
