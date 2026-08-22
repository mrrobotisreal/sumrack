import {
  CefrLevelSchema,
  safeParsePack,
  type Pack,
  type Sentence,
  type Story,
  type Token,
} from '@sumrak/schema';
import { alignSentence } from './align.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import type { DraftSentence, DraftTokenRow, ParsedDraft } from './draft.ts';
import type { PackExtras } from './extras.ts';

/**
 * Assembly: parsed drafts (one per story) → a schema-valid Pack.
 *
 * All the "fail loudly" checks that need draft line numbers happen here —
 * missing lemma/translation on word tokens, punctuation rows carrying
 * annotations, bad CEFR cells, misaligned token tables, duplicate ids across
 * drafts. The final Zod parse against `@sumrak/schema`'s PackSchema is the
 * backstop gate (design §8: annotate's output is schema-validated before it is
 * ever written); with the pre-checks above it should never fire, but if it
 * does its issues are reported rather than swallowed.
 */

/** Word/punctuation classification: a token with no letters or digits is punctuation. */
export function isPunctText(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** Fields punctuation tokens must not carry (mirrors the schema's rule). */
const PUNCT_FORBIDDEN = ['lemma', 'translation', 'pos', 'grammar', 'level'] as const;

function rowToToken(
  file: string,
  row: DraftTokenRow,
  spaceBefore: boolean,
  index: number,
  issues: DraftIssue[],
): Token {
  const punct = isPunctText(row.text);
  const token: Token = { text: row.text };

  if (punct) {
    token.isPunct = true;
    for (const field of PUNCT_FORBIDDEN) {
      if (row[field] !== undefined) {
        issues.push({
          file,
          line: row.line,
          message: `punctuation token "${row.text}" must not have a "${field}" — leave the cell empty`,
        });
      }
    }
    if (row.note !== undefined) token.note = row.note;
  } else {
    if (row.lemma === undefined) {
      issues.push({
        file,
        line: row.line,
        message: `word token "${row.text}" is missing its lemma — every word needs a dictionary form (no auto-fill, by design)`,
      });
    }
    if (row.translation === undefined) {
      issues.push({
        file,
        line: row.line,
        message: `word token "${row.text}" is missing its translation — every word needs a context gloss (no auto-fill, by design)`,
      });
    }
    if (row.lemma !== undefined) token.lemma = row.lemma;
    if (row.translation !== undefined) token.translation = row.translation;
    if (row.pos !== undefined) token.pos = row.pos;
    if (row.grammar !== undefined) token.grammar = row.grammar;
    if (row.level !== undefined) {
      const parsed = CefrLevelSchema.safeParse(row.level);
      if (parsed.success) {
        token.level = parsed.data;
      } else {
        issues.push({
          file,
          line: row.line,
          message: `token "${row.text}" has invalid CEFR level "${row.level}" (expected A1, A2, B1, B2, or C1)`,
        });
      }
    }
    if (row.note !== undefined) token.note = row.note;
  }

  // Only emit spaceBefore when it differs from the schema's default
  // (space before every token except the first and punctuation).
  const defaultSpace = index > 0 && !punct;
  if (spaceBefore !== defaultSpace) token.spaceBefore = spaceBefore;

  return token;
}

function assembleSentence(file: string, draft: DraftSentence, issues: DraftIssue[]): Sentence {
  const aligned = alignSentence(file, draft);
  // On misalignment, fall back to default spacing so assembly can continue
  // collecting other issues; the run still fails via the pushed issues.
  const spaceBefore = aligned.ok ? aligned.spaceBefore : draft.rows.map((_, i) => i > 0);
  if (!aligned.ok) issues.push(...aligned.issues);

  const sentence: Sentence = {
    id: draft.id,
    ru: draft.ru,
    en: draft.en,
    tokens: draft.rows.map((row, i) => rowToToken(file, row, spaceBefore[i] ?? false, i, issues)),
  };
  if (draft.grammarTopics !== undefined) sentence.grammarTopics = draft.grammarTopics;
  return sentence;
}

/**
 * Assemble parsed drafts (plus optional pack extras — lesson / prompts /
 * exercises, T17) into a Pack. Story order = argument order. A pack with no
 * story drafts at all (checkpoint / prompts types) assembles from extras
 * alone, which must then carry the `pack:` meta. Throws {@link DraftError}
 * with every issue found if the inputs cannot produce a valid pack.
 */
export function assemblePack(drafts: readonly ParsedDraft[], extras?: PackExtras): Pack {
  if (drafts.length === 0 && !extras) {
    throw new DraftError([{ file: '(none)', message: 'no drafts given' }]);
  }
  if (drafts.length === 0 && extras && !extras.pack) {
    throw new DraftError([
      {
        file: extras.file,
        line: 2,
        message:
          'a pack with no story drafts must carry its "pack:" meta in the extras frontmatter',
      },
    ]);
  }
  const issues: DraftIssue[] = [];

  // Pack meta must be identical across all drafts of a multi-story pack.
  const first = drafts[0];
  const packMetaJson = JSON.stringify(first ? first.frontmatter.pack : extras!.pack);
  for (const d of drafts.slice(1)) {
    if (JSON.stringify(d.frontmatter.pack) !== packMetaJson) {
      issues.push({
        file: d.file,
        line: 2,
        message: `frontmatter "pack" section differs from ${first!.file} — all drafts of one pack must carry identical pack meta`,
      });
    }
  }
  // …and the extras' pack meta (when present next to drafts) must match too.
  if (first && extras?.pack && JSON.stringify(extras.pack) !== packMetaJson) {
    issues.push({
      file: extras.file,
      line: 2,
      message: `extras "pack" section differs from ${first.file} — extras must carry the same pack meta as the drafts (or omit it)`,
    });
  }

  // Unique story ids per pack, unique sentence ids pack-wide.
  const storyIds = new Map<string, string>();
  const sentenceIds = new Map<string, { file: string; line: number }>();
  for (const d of drafts) {
    const sid = d.frontmatter.story.id;
    const seenIn = storyIds.get(sid);
    if (seenIn !== undefined) {
      issues.push({
        file: d.file,
        line: 2,
        message: `duplicate story id "${sid}" (already used in ${seenIn})`,
      });
    }
    storyIds.set(sid, d.file);
    for (const s of d.sentences) {
      const seen = sentenceIds.get(s.id);
      if (seen !== undefined) {
        issues.push({
          file: d.file,
          line: s.line,
          message: `duplicate sentence id "${s.id}" (already used at ${seen.file}:${seen.line}) — sentence ids are unique pack-wide`,
        });
      }
      sentenceIds.set(s.id, { file: d.file, line: s.line });
    }
  }

  const stories: Story[] = drafts.map((d) => ({
    id: d.frontmatter.story.id,
    title: d.frontmatter.story.title,
    level: d.frontmatter.story.level,
    sentences: d.sentences.map((s) => assembleSentence(d.file, s, issues)),
    audio: [], // audio tracks are attached by T09's `pipeline audio`
  }));

  const meta = first ? first.frontmatter.pack : extras!.pack!;
  const pack: Pack = {
    id: meta.id,
    version: meta.version,
    type: meta.type,
    title: meta.title,
    level: meta.level,
    tags: meta.tags,
    stories,
  };
  if (extras?.lesson) pack.lesson = extras.lesson;
  if (extras?.prompts) pack.prompts = extras.prompts;
  if (extras?.exercises) pack.exercises = extras.exercises;

  // Extras id hygiene: prompt/exercise ids unique within their section.
  for (const [section, ids] of [
    ['prompts', extras?.prompts?.map((p) => p.id)],
    ['exercises', extras?.exercises?.map((e) => e.id)],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids ?? []) {
      if (seen.has(id)) {
        issues.push({
          file: extras!.file,
          line: 2,
          message: `duplicate ${section} id "${id}" in extras`,
        });
      }
      seen.add(id);
    }
  }

  if (issues.length > 0) throw new DraftError(issues);

  // Backstop: the emitted pack must validate against the shared schema.
  const result = safeParsePack(pack);
  if (!result.success) {
    throw new DraftError(
      result.issues.map((i) => ({
        file: first?.file ?? extras!.file,
        message: `assembled pack failed schema validation at ${i.path}: ${i.message}`,
      })),
    );
  }
  return result.data;
}
