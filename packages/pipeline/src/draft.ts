import YAML from 'yaml';
import { DraftError, type DraftIssue } from './errors.ts';
import { FrontmatterSchema, type Frontmatter } from './frontmatter.ts';

/**
 * Draft parser: one authored markdown draft file → an intermediate
 * representation with a line number on every construct. The draft grammar is
 * documented for authors in `docs/AUTHORING.md`; this file is its
 * implementation. Parsing is deliberately strict — an unrecognized line is an
 * error, never silently skipped — because drafts are written by Claude
 * sessions and silent tolerance would hide authoring mistakes.
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

/** One `## sentence-id` block of a draft. */
export interface DraftSentence {
  /** 1-based line number of the `##` heading. */
  line: number;
  id: string;
  ru: string;
  /** Line the RU: text sits on (alignment errors point here). */
  ruLine: number;
  en: string;
  grammarTopics?: string[];
  rows: DraftTokenRow[];
}

/** A fully parsed draft file (frontmatter + sentence blocks). */
export interface ParsedDraft {
  /** Draft file path as given (used in error messages). */
  file: string;
  frontmatter: Frontmatter;
  sentences: DraftSentence[];
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

/** NFC-normalize every string in a parsed YAML value (ё is preserved: NFC never folds ё→е). */
export function normalizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeDeep(v)]),
    );
  }
  return value;
}

/** Split a `| a | b |` table line into trimmed cells, honoring `\|` escapes. */
function splitTableRow(line: string): string[] | null {
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

interface OpenSentence {
  sentence: DraftSentence;
  sawHeader: boolean;
  sawSeparator: boolean;
}

/**
 * Parse one draft file's text. Collects every issue it can find; throws
 * {@link DraftError} if any were found.
 */
export function parseDraft(file: string, source: string): ParsedDraft {
  const issues: DraftIssue[] = [];
  const lines = source.split(/\r?\n/);

  // --- frontmatter ------------------------------------------------------
  if (lines[0]?.trim() !== '---') {
    throw new DraftError([
      { file, line: 1, message: 'draft must start with a "---" YAML frontmatter fence' },
    ]);
  }
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (fmEnd === -1) {
    throw new DraftError([
      { file, line: 1, message: 'frontmatter is never closed (no second "---" fence)' },
    ]);
  }
  const fmText = lines.slice(1, fmEnd).join('\n');
  let frontmatter: Frontmatter | undefined;
  try {
    const raw = normalizeDeep(YAML.parse(fmText));
    const result = FrontmatterSchema.safeParse(raw);
    if (result.success) {
      frontmatter = result.data;
    } else {
      for (const issue of result.error.issues) {
        const path =
          issue.path.length === 0 ? 'frontmatter' : `frontmatter ${issue.path.join('.')}`;
        issues.push({ file, line: 2, message: `${path}: ${issue.message}` });
      }
    }
  } catch (e) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // --- body: sentence blocks -------------------------------------------
  const sentences: DraftSentence[] = [];
  let open: OpenSentence | null = null;

  const closeSentence = () => {
    if (!open) return;
    const { sentence, sawHeader } = open;
    if (sentence.ru === '') {
      issues.push({
        file,
        line: sentence.line,
        message: `sentence "${sentence.id}" has no RU: line`,
      });
    }
    if (sentence.en === '') {
      issues.push({
        file,
        line: sentence.line,
        message: `sentence "${sentence.id}" has no EN: line`,
      });
    }
    if (!sawHeader || sentence.rows.length === 0) {
      issues.push({
        file,
        line: sentence.line,
        message: `sentence "${sentence.id}" has no token table (header row + at least one token row required)`,
      });
    }
    sentences.push(sentence);
    open = null;
  };

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i]!;
    const line = raw.trim();

    if (line === '') continue;
    if (line.startsWith('<!--') && line.endsWith('-->')) continue; // comment
    if (/^#\s/.test(line)) continue; // decorative H1 (e.g. story title) — ignored

    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (/^#{3,}\s/.test(line)) {
        issues.push({
          file,
          line: lineNo,
          message: 'only "##" sentence headings are allowed (no deeper heading levels)',
        });
        continue;
      }
      closeSentence();
      const id = heading[1]!.trim().normalize('NFC');
      open = {
        sentence: { line: lineNo, id, ru: '', ruLine: lineNo, en: '', rows: [] },
        sawHeader: false,
        sawSeparator: false,
      };
      continue;
    }

    if (!open) {
      issues.push({
        file,
        line: lineNo,
        message: `unexpected content before the first "## <sentence-id>" heading: "${line}"`,
      });
      continue;
    }
    const cur: OpenSentence = open;

    const key = KEY_LINE.exec(line);
    if (key) {
      const value = key[2]!.trim().normalize('NFC');
      if (cur.sawHeader) {
        issues.push({
          file,
          line: lineNo,
          message: `${key[1]}: line must come before the token table`,
        });
        continue;
      }
      if (key[1] === 'RU') {
        if (cur.sentence.ru !== '')
          issues.push({ file, line: lineNo, message: 'duplicate RU: line' });
        if (value === '') issues.push({ file, line: lineNo, message: 'RU: line is empty' });
        cur.sentence.ru = value;
        cur.sentence.ruLine = lineNo;
      } else if (key[1] === 'EN') {
        if (cur.sentence.en !== '')
          issues.push({ file, line: lineNo, message: 'duplicate EN: line' });
        if (value === '') issues.push({ file, line: lineNo, message: 'EN: line is empty' });
        cur.sentence.en = value;
      } else {
        const topics = value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== '');
        if (topics.length === 0) {
          issues.push({ file, line: lineNo, message: 'GRAMMAR: line has no topics' });
        }
        cur.sentence.grammarTopics = topics;
      }
      continue;
    }

    const cells = splitTableRow(raw);
    if (cells) {
      if (!cur.sawHeader) {
        const expected = TABLE_COLUMNS.join(', ');
        const got = cells.map((c) => c.toLowerCase());
        if (got.length !== TABLE_COLUMNS.length || got.some((c, k) => c !== TABLE_COLUMNS[k])) {
          issues.push({
            file,
            line: lineNo,
            message: `token table header must be exactly: ${expected} (got: ${cells.join(', ')})`,
          });
        }
        cur.sawHeader = true;
        continue;
      }
      if (!cur.sawSeparator) {
        if (!isSeparatorRow(cells)) {
          issues.push({
            file,
            line: lineNo,
            message: 'expected the "| --- |" separator row under the table header',
          });
        }
        cur.sawSeparator = true;
        continue;
      }
      if (cells.length !== TABLE_COLUMNS.length) {
        issues.push({
          file,
          line: lineNo,
          message: `token row has ${cells.length} cells, expected ${TABLE_COLUMNS.length} (text, lemma, translation, pos, grammar, level, note)`,
        });
        continue;
      }
      const norm = (c: string | undefined): string | undefined => {
        const v = (c ?? '').normalize('NFC');
        return v === '' ? undefined : v;
      };
      const text = norm(cells[0]);
      if (text === undefined) {
        issues.push({ file, line: lineNo, message: 'token row has an empty "text" cell' });
        continue;
      }
      cur.sentence.rows.push({
        line: lineNo,
        text,
        lemma: norm(cells[1]),
        translation: norm(cells[2]),
        pos: norm(cells[3]),
        grammar: norm(cells[4]),
        level: norm(cells[5]),
        note: norm(cells[6]),
      });
      continue;
    }

    issues.push({
      file,
      line: lineNo,
      message: `unrecognized line (expected "## <id>", "RU:", "EN:", "GRAMMAR:", a "|" table row, or a blank line): "${line}"`,
    });
  }
  closeSentence();

  if (sentences.length === 0) {
    issues.push({ file, message: 'draft has no sentence blocks ("## <sentence-id>")' });
  }
  if (issues.length > 0) throw new DraftError(issues);

  // frontmatter is defined here: its failure always pushes issues.
  return { file, frontmatter: frontmatter as Frontmatter, sentences };
}
