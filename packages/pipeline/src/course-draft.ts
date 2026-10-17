import { CourseItemSchema, CourseSchema, type Course, type CourseItem } from '@sumrak/schema';
import YAML, { LineCounter, isNode } from 'yaml';
import { z } from 'zod';
import { normalizeDeep, splitFrontmatter } from './draft.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import { PackMetaSchema, type PackMeta } from './frontmatter.ts';

/**
 * Course draft parser (T88, M25, ADR-0022): one `*.course.md` file = one floor
 * (one `course` pack). YAML frontmatter only — a `course:` key (the whole
 * {@link Course} object, validated by the shared `CourseSchema`) and an `items:`
 * list (the pack's scored and check items, validated by `CourseItemSchema`),
 * plus an optional `pack:` meta. The markdown body is ignored (author notes).
 * Sniffed by the `course:` key in `sniffDraftKind`, never by filename.
 *
 * Body strings in YAML use block scalars (`|`) so long `explain` cards stay
 * readable. Errors carry the line of the offending YAML node, so a 15-floor
 * course stays debuggable without opening every draft.
 */

export const CourseFrontmatterSchema = z.strictObject({
  pack: PackMetaSchema.optional(),
  course: CourseSchema,
  items: z.array(CourseItemSchema).default([]),
});

export interface ParsedCourseDraft {
  file: string;
  pack?: PackMeta;
  course: Course;
  items: CourseItem[];
  /** 1-based file line of the YAML node at `path` (relative to the draft root), or of its nearest ancestor. */
  lineAt: (path: readonly PropertyKey[]) => number;
}

export function parseCourseDraft(file: string, source: string): ParsedCourseDraft {
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

  const result = CourseFrontmatterSchema.safeParse(normalizeDeep(doc.toJS()) ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      // `course.…` and `items.…` paths are mapped to their own YAML lines; the
      // draft root is the frontmatter, so no path prefix is added.
      const path = issue.path.length === 0 ? 'frontmatter' : `frontmatter ${issue.path.join('.')}`;
      issues.push({ file, line: lineOfRoot(issue.path), message: `${path}: ${issue.message}` });
    }
    throw new DraftError(issues);
  }

  const parsed: ParsedCourseDraft = {
    file,
    course: result.data.course,
    items: result.data.items,
    lineAt: (path) => lineOfRoot(path),
  };
  if (result.data.pack) parsed.pack = result.data.pack;
  return parsed;
}
