import type { DraftIssue } from './errors.ts';
import type { DraftSentence } from './draft.ts';

/**
 * Token alignment: walk the authored sentence text consuming each token row's
 * surface form in order, deriving per-token `spaceBefore` from the actual
 * spacing in the sentence. Because the derivation *is* the reconstruction
 * invariant (schema §4.2: tokens must rebuild `ru` exactly), a draft that
 * aligns here can never fail the schema's reconstruction check — and authors
 * never hand-maintain `spaceBefore`.
 */

export type AlignResult =
  { ok: true; spaceBefore: boolean[] } | { ok: false; issues: DraftIssue[] };

/** A short excerpt of the sentence around an offset, for error messages. */
function excerpt(ru: string, at: number): string {
  const from = Math.max(0, at - 10);
  const to = Math.min(ru.length, at + 15);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < ru.length ? '…' : '';
  return `${prefix}${ru.slice(from, at)}⟨here⟩${ru.slice(at, to)}${suffix}`;
}

/**
 * Align a sentence's token rows against its RU text. On success returns the
 * derived `spaceBefore` per token; on failure, precise line-level issues.
 */
export function alignSentence(file: string, sentence: DraftSentence): AlignResult {
  const { ru, rows } = sentence;
  const spaceBefore: boolean[] = [];
  let pos = 0;

  for (const row of rows) {
    let space = false;
    if (ru[pos] === ' ') {
      space = true;
      pos += 1;
      if (ru[pos] === ' ') {
        return {
          ok: false,
          issues: [
            {
              file,
              line: sentence.ruLine,
              message: `sentence "${sentence.id}" contains a double space at offset ${pos}: "${excerpt(ru, pos)}"`,
            },
          ],
        };
      }
    }
    if (!ru.startsWith(row.text, pos)) {
      return {
        ok: false,
        issues: [
          {
            file,
            line: row.line,
            message:
              `token "${row.text}" does not match sentence "${sentence.id}" at offset ${pos}: ` +
              `"${excerpt(ru, pos)}" — token surfaces must appear in order and rebuild the sentence exactly`,
          },
        ],
      };
    }
    pos += row.text.length;
    spaceBefore.push(space);
  }

  if (pos !== ru.length) {
    return {
      ok: false,
      issues: [
        {
          file,
          line: rows[rows.length - 1]?.line ?? sentence.ruLine,
          message:
            `token table for sentence "${sentence.id}" ends before the sentence does — ` +
            `unconsumed text: "${excerpt(ru, pos)}"`,
        },
      ],
    };
  }

  return { ok: true, spaceBefore };
}
