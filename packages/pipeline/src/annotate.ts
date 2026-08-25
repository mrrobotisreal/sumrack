import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Pack } from '@sumrak/schema';
import { assemblePack } from './assemble.ts';
import { parseDialogueDraft, sniffDraftKind, type ParsedDialogueDraft } from './dialogue-draft.ts';
import { parseDraft, type ParsedDraft } from './draft.ts';
import { loadExtras, type PackExtras } from './extras.ts';

/**
 * `pipeline annotate`: draft file(s) → validated pack.json.
 * One draft file = one story (or, since T25, one dialogue — recognized by the
 * `dialogue:` frontmatter section, not the filename); a multi-story pack is
 * several drafts with identical `pack` frontmatter, given in reading order.
 * `course-unit` / `checkpoint` / `prompts` packs add (or consist entirely of)
 * an extras file (`--extras`, T17) carrying lesson / prompts / exercises.
 */

/** Parse + assemble, no file output. Throws DraftError on any problem. */
export function annotateDrafts(
  files: readonly { path: string; source: string }[],
  extras?: PackExtras,
): Pack {
  const storyDrafts: ParsedDraft[] = [];
  const dialogueDrafts: ParsedDialogueDraft[] = [];
  for (const f of files) {
    if (sniffDraftKind(f.path, f.source) === 'dialogue') {
      dialogueDrafts.push(parseDialogueDraft(f.path, f.source));
    } else {
      storyDrafts.push(parseDraft(f.path, f.source));
    }
  }
  return assemblePack(storyDrafts, extras, dialogueDrafts);
}

export interface AnnotateSummary {
  pack: Pack;
  outFile: string;
  stories: number;
  dialogues: number;
  sentences: number;
  tokens: number;
}

/** Every sentence of a pack — story sentences plus dialogue node/choice lines. */
function allSentences(pack: Pack) {
  return [
    ...pack.stories.flatMap((s) => s.sentences),
    ...(pack.dialogues ?? []).flatMap((d) =>
      d.nodes.flatMap((n) => [n.sentence, ...(n.choices?.map((c) => c.sentence) ?? [])]),
    ),
  ];
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
  const sentences = allSentences(pack);
  return {
    pack,
    outFile,
    stories: pack.stories.length,
    dialogues: pack.dialogues?.length ?? 0,
    sentences: sentences.length,
    tokens: sentences.reduce((n, s) => n + s.tokens.length, 0),
  };
}
