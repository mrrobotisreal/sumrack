import YAML from 'yaml';
import { DraftError, type DraftIssue } from './errors.ts';
import { FrontmatterSchema, type Frontmatter } from './frontmatter.ts';
import { SentenceBlockCollector, type DraftSentence } from './sentence-block.ts';

/**
 * Draft parser: one authored markdown draft file → an intermediate
 * representation with a line number on every construct. The draft grammar is
 * documented for authors in `docs/AUTHORING.md`; this file is its
 * implementation. Parsing is deliberately strict — an unrecognized line is an
 * error, never silently skipped — because drafts are written by Claude
 * sessions and silent tolerance would hide authoring mistakes.
 *
 * The sentence-block grammar itself (RU/EN/GRAMMAR + token table) lives in
 * `sentence-block.ts`, shared verbatim with the dialogue draft parser (T25).
 */

// Re-exported so existing imports (tests, index) keep working after the T25 split.
export type { DraftSentence, DraftTokenRow } from './sentence-block.ts';
export { TABLE_COLUMNS } from './sentence-block.ts';

/** A fully parsed draft file (frontmatter + sentence blocks). */
export interface ParsedDraft {
  /** Draft file path as given (used in error messages). */
  file: string;
  frontmatter: Frontmatter;
  sentences: DraftSentence[];
}

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

/**
 * Split a draft file into its frontmatter text and body lines, reporting
 * fence problems as thrown DraftErrors. Shared by the story and dialogue
 * draft parsers (and mirroring extras.ts).
 */
export function splitFrontmatter(
  file: string,
  source: string,
): { fmText: string; lines: string[]; fmEnd: number } {
  const lines = source.split(/\r?\n/);
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
  return { fmText: lines.slice(1, fmEnd).join('\n'), lines, fmEnd };
}

/**
 * Parse + Zod-validate a draft's frontmatter YAML, pushing issues in the
 * shared `frontmatter <path>: <message>` format. Returns undefined when
 * anything failed (issues were pushed).
 */
export function parseFrontmatterWith<T>(
  file: string,
  fmText: string,
  schema: {
    safeParse: (
      v: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  issues: DraftIssue[],
): T | undefined {
  try {
    const raw = normalizeDeep(YAML.parse(fmText));
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const path = issue.path.length === 0 ? 'frontmatter' : `frontmatter ${issue.path.join('.')}`;
      issues.push({ file, line: 2, message: `${path}: ${issue.message}` });
    }
  } catch (e) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  return undefined;
}

/**
 * Parse one story draft file's text. Collects every issue it can find; throws
 * {@link DraftError} if any were found.
 */
export function parseDraft(file: string, source: string): ParsedDraft {
  const issues: DraftIssue[] = [];
  const { fmText, lines, fmEnd } = splitFrontmatter(file, source);
  const frontmatter = parseFrontmatterWith(file, fmText, FrontmatterSchema, issues);

  // --- body: sentence blocks -------------------------------------------
  const sentences: DraftSentence[] = [];
  let open: SentenceBlockCollector | null = null;

  const closeSentence = () => {
    if (!open) return;
    sentences.push(open.finish());
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
      open = new SentenceBlockCollector(file, issues, lineNo, id, `sentence "${id}"`);
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

    if (open.tryLine(raw, line, lineNo)) continue;

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
