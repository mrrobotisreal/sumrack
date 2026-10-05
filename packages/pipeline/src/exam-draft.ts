import { ExamSchema, type Exam } from '@sumrak/schema';
import YAML, { LineCounter, isNode } from 'yaml';
import { z } from 'zod';
import { normalizeDeep, splitFrontmatter } from './draft.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import { PackMetaSchema, type PackMeta } from './frontmatter.ts';

/**
 * Exam draft parser (T67, TORFL_EXAM_PREP §3.3): one `*.exam.md` file = one
 * exam. YAML frontmatter only — a single `exam:` key (the whole {@link Exam}
 * object, validated by the shared `ExamSchema`) plus an optional `pack:` meta;
 * the markdown body is ignored (author notes). Sniffed by the `exam:` key in
 * `sniffDraftKind`, never by filename.
 *
 * An exam pack = ordinary story drafts (passages, listening scripts, examiner
 * lines, model answers — referenced by id) + one exam draft per exam, given
 * to `annotate` together. `pack:` follows the extras precedent: optional next
 * to story drafts (it must then match them byte-for-byte), required when the
 * pack has no story drafts — and such a story-less pack's exams may carry no
 * story refs at all.
 *
 * Errors carry the line of the offending YAML node (not just "line 2"), so a
 * 280-item drill bank stays debuggable.
 */

export const ExamFrontmatterSchema = z.strictObject({
  pack: PackMetaSchema.optional(),
  exam: ExamSchema,
});

export interface ParsedExamDraft {
  file: string;
  pack?: PackMeta;
  exam: Exam;
  /** 1-based file line of the YAML node at `path` (relative to `exam`), or of its nearest ancestor. */
  lineAt: (path: readonly PropertyKey[]) => number;
}

/** Parse a `exams[0].subtests[2].parts[0].items[1]` style path back into segments. */
export function parseIssuePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (m[2] !== undefined) out.push(Number(m[2]));
    else if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

export function parseExamDraft(file: string, source: string): ParsedExamDraft {
  const { fmText } = splitFrontmatter(file, source);
  const lineCounter = new LineCounter();
  const doc = YAML.parseDocument(fmText, { lineCounter, prettyErrors: false });

  /** Frontmatter starts on file line 2 (line 1 is the opening fence). */
  const lineOfRoot = (path: readonly PropertyKey[]): number => {
    for (let n = path.length; n >= 0; n--) {
      const node = doc.getIn(path.slice(0, n) as unknown[], true);
      if (isNode(node) && node.range) return lineCounter.linePos(node.range[0]).line + 1;
    }
    return 2;
  };

  const issues: DraftIssue[] = [];
  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const line = err.linePos?.[0]?.line;
      issues.push({
        file,
        line: line === undefined ? 2 : line + 1,
        message: `frontmatter is not valid YAML: ${err.message.split('\n')[0]}`,
      });
    }
    throw new DraftError(issues);
  }

  const result = ExamFrontmatterSchema.safeParse(normalizeDeep(doc.toJS()) ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length === 0 ? 'frontmatter' : `frontmatter ${issue.path.join('.')}`;
      issues.push({ file, line: lineOfRoot(issue.path), message: `${path}: ${issue.message}` });
    }
    throw new DraftError(issues);
  }

  const parsed: ParsedExamDraft = {
    file,
    exam: result.data.exam,
    lineAt: (path) => lineOfRoot(['exam', ...path]),
  };
  if (result.data.pack) parsed.pack = result.data.pack;
  return parsed;
}
