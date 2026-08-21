/**
 * Draft-processing errors. Every issue points at a file and (where the
 * construct has one) a 1-based line number, so authors can jump straight to
 * the problem — "fail loudly with a precise location" is a design requirement
 * (design §8), not a nicety.
 */

/** One problem found in a draft (or in the assembled pack). */
export interface DraftIssue {
  /** Path of the draft file the issue was found in (as given on the CLI). */
  file: string;
  /** 1-based line number, when the construct maps to one (undefined for e.g. whole-file issues). */
  line?: number;
  /** Human-readable description of what is wrong. */
  message: string;
}

/** Format one issue as a grep/editor-friendly `file:line: message` line. */
export function formatIssue(issue: DraftIssue): string {
  return issue.line === undefined
    ? `${issue.file}: ${issue.message}`
    : `${issue.file}:${issue.line}: ${issue.message}`;
}

/**
 * Thrown when a draft cannot be turned into a valid pack. Carries every issue
 * found (the pipeline collects as many as it can before giving up, so one run
 * surfaces all gaps rather than one per run).
 */
export class DraftError extends Error {
  readonly issues: readonly DraftIssue[];

  constructor(issues: readonly DraftIssue[]) {
    const lines = issues.map(formatIssue);
    super(
      `draft has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
    );
    this.name = 'DraftError';
    this.issues = issues;
  }
}
