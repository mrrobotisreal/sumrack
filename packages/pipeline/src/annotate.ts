import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Pack } from '@sumrak/schema';
import { assemblePack } from './assemble.ts';
import { parseDraft, type ParsedDraft } from './draft.ts';
import { loadExtras, type PackExtras } from './extras.ts';

/**
 * `pipeline annotate`: draft file(s) → validated pack.json.
 * One draft file = one story; a multi-story pack is several drafts with
 * identical `pack` frontmatter, given in reading order. `course-unit` /
 * `checkpoint` / `prompts` packs add (or consist entirely of) an extras file
 * (`--extras`, T17) carrying lesson / prompts / exercises.
 */

/** Parse + assemble, no file output. Throws DraftError on any problem. */
export function annotateDrafts(
  files: readonly { path: string; source: string }[],
  extras?: PackExtras,
): Pack {
  const parsed: ParsedDraft[] = files.map((f) => parseDraft(f.path, f.source));
  return assemblePack(parsed, extras);
}

export interface AnnotateSummary {
  pack: Pack;
  outFile: string;
  stories: number;
  sentences: number;
  tokens: number;
}

/** Read drafts from disk, assemble, write `pack.json`. Throws DraftError on any problem. */
export function runAnnotate(
  draftPaths: readonly string[],
  outFile: string,
  extrasPath?: string,
): AnnotateSummary {
  const pack = annotateDrafts(
    draftPaths.map((path) => ({ path, source: readFileSync(path, 'utf8') })),
    extrasPath === undefined ? undefined : loadExtras(extrasPath),
  );
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  const sentences = pack.stories.reduce((n, s) => n + s.sentences.length, 0);
  const tokens = pack.stories.reduce(
    (n, s) => n + s.sentences.reduce((m, q) => m + q.tokens.length, 0),
    0,
  );
  return { pack, outFile, stories: pack.stories.length, sentences, tokens };
}
