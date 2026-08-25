import {
  CefrLevelSchema,
  MAX_CHOICES_PER_NODE,
  MAX_DIALOGUE_NODES,
  MIN_CHOICES_PER_NODE,
  PLAYER_CHARACTER_ID,
  analyzeDialogueGraph,
  safeParsePack,
  type Choice,
  type Dialogue,
  type DialogueNode,
  type Pack,
  type Sentence,
  type Story,
  type Token,
} from '@sumrak/schema';
import { alignSentence } from './align.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import type { DraftSentence, DraftTokenRow, ParsedDraft } from './draft.ts';
import type { DraftDialogueNode, ParsedDialogueDraft } from './dialogue-draft.ts';
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
 * Assemble one parsed dialogue draft into a Dialogue (T25). Characters and
 * endings come from the frontmatter (already Zod-validated shapes); nodes and
 * choices get their sentences through the same alignment/annotation path as
 * story sentences. Every check that can carry a draft line number happens
 * here — speaker resolution, target resolution, bounds, duplicate ids, the
 * graph properties — so authors get `file:line:` errors; the shared schema's
 * path-precise refinements remain the backstop.
 */
function assembleDialogue(draft: ParsedDialogueDraft, issues: DraftIssue[]): Dialogue {
  const { file, frontmatter } = draft;
  const characterIds = new Set(frontmatter.characters.map((c) => c.id));
  const endingIds = new Set(frontmatter.endings.map((e) => e.id));
  const nodeIds = new Set(draft.nodes.map((n) => n.id));
  const before = issues.length;

  if (draft.nodes.length > MAX_DIALOGUE_NODES) {
    issues.push({
      file,
      line: draft.nodes[MAX_DIALOGUE_NODES]!.line,
      message: `dialogue "${frontmatter.dialogue.id}" has ${draft.nodes.length} nodes — the maximum is ${MAX_DIALOGUE_NODES}`,
    });
  }

  const seenNodeIds = new Map<string, DraftDialogueNode>();
  const nodes: DialogueNode[] = draft.nodes.map((draftNode) => {
    const seen = seenNodeIds.get(draftNode.id);
    if (seen !== undefined) {
      issues.push({
        file,
        line: draftNode.line,
        message: `duplicate node id "${draftNode.id}" (already used at ${file}:${seen.line})`,
      });
    }
    seenNodeIds.set(draftNode.id, draftNode);

    if (draftNode.speakerId !== undefined && !characterIds.has(draftNode.speakerId)) {
      issues.push({
        file,
        line: draftNode.speakerLine ?? draftNode.line,
        message: `node "${draftNode.id}" SPEAKER "${draftNode.speakerId}" is not in the characters list (${[...characterIds].join(', ')})`,
      });
    }

    const node: DialogueNode = {
      id: draftNode.id,
      // '' only when SPEAKER: was missing — the parser already errored, so
      // assembly never survives to the schema backstop in that case.
      speakerId: draftNode.speakerId ?? '',
      sentence: assembleSentence(file, draftNode.sentence, issues),
    };

    const term = draftNode.terminator;
    if (term?.kind === 'next') {
      if (!nodeIds.has(term.target)) {
        issues.push({
          file,
          line: term.line,
          message: `node "${draftNode.id}" NEXT target "${term.target}" is not a node in this draft`,
        });
      }
      node.next = term.target;
    } else if (term?.kind === 'ending') {
      if (!endingIds.has(term.target)) {
        issues.push({
          file,
          line: term.line,
          message: `node "${draftNode.id}" ENDING "${term.target}" is not defined in the endings frontmatter (${[...endingIds].join(', ')})`,
        });
      }
      node.endingId = term.target;
    } else if (term?.kind === 'choices') {
      if (draftNode.speakerId === PLAYER_CHARACTER_ID) {
        issues.push({
          file,
          line: draftNode.line,
          message: `node "${draftNode.id}" speaks as "player" but has CHOICES — choices already speak as the player; put them on the line being answered (an NPC node)`,
        });
      }
      if (
        term.choices.length < MIN_CHOICES_PER_NODE ||
        term.choices.length > MAX_CHOICES_PER_NODE
      ) {
        issues.push({
          file,
          line: term.line,
          message: `node "${draftNode.id}" has ${term.choices.length} choice${term.choices.length === 1 ? '' : 's'} — a choice point needs ${MIN_CHOICES_PER_NODE}–${MAX_CHOICES_PER_NODE}`,
        });
      }
      const seenChoiceIds = new Set<string>();
      node.choices = term.choices.map((draftChoice) => {
        if (seenChoiceIds.has(draftChoice.id)) {
          issues.push({
            file,
            line: draftChoice.line,
            message: `duplicate choice id "${draftChoice.id}" in node "${draftNode.id}"`,
          });
        }
        seenChoiceIds.add(draftChoice.id);
        if (!nodeIds.has(draftChoice.targetId)) {
          issues.push({
            file,
            line: draftChoice.line,
            message: `choice "${draftChoice.id}" target "${draftChoice.targetId}" is not a node in this draft`,
          });
        }
        const choice: Choice = {
          id: draftChoice.id,
          sentence: assembleSentence(file, draftChoice.sentence, issues),
          next: draftChoice.targetId,
        };
        if (draftChoice.alts.length > 0) choice.asrAlternates = draftChoice.alts.map((a) => a.text);
        if (draftChoice.hint) choice.hint = { ru: draftChoice.hint.ru, en: draftChoice.hint.en };
        return choice;
      });
    }
    return node;
  });

  const startNodeId = frontmatter.dialogue.startNodeId ?? draft.nodes[0]!.id;
  if (!nodeIds.has(startNodeId)) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter dialogue.startNodeId "${startNodeId}" is not a node in this draft`,
    });
  }

  const dialogue: Dialogue = {
    id: frontmatter.dialogue.id,
    title: frontmatter.dialogue.title,
    level: frontmatter.dialogue.level,
    characters: frontmatter.characters,
    nodes,
    startNodeId,
    endings: frontmatter.endings,
  };

  // Graph properties — only when every reference resolved (otherwise the
  // reachability fallout would bury the precise errors above).
  if (issues.length === before) {
    const analysis = analyzeDialogueGraph(dialogue);
    const lineOf = new Map(draft.nodes.map((n) => [n.id, n.line]));
    for (const id of analysis.unreachable) {
      issues.push({
        file,
        line: lineOf.get(id),
        message: `node "${id}" is unreachable from the start node "${startNodeId}" — dead branch`,
      });
    }
    for (const id of analysis.deadTraps) {
      issues.push({
        file,
        line: lineOf.get(id),
        message: `node "${id}" can never reach an ending (dead trap — every cycle needs an exit path to an ending)`,
      });
    }
    for (const id of analysis.unreferencedEndings) {
      issues.push({
        file,
        line: 2,
        message: `ending "${id}" is never referenced by any node — point a node's ENDING: at it or delete it`,
      });
    }
  }

  return dialogue;
}

/**
 * Assemble parsed drafts (story drafts + dialogue drafts, plus optional pack
 * extras — lesson / prompts / exercises, T17) into a Pack. Story/dialogue
 * order = argument order. A pack with no drafts at all (checkpoint / prompts
 * types) assembles from extras alone, which must then carry the `pack:` meta.
 * Throws {@link DraftError} with every issue found if the inputs cannot
 * produce a valid pack.
 */
export function assemblePack(
  drafts: readonly ParsedDraft[],
  extras?: PackExtras,
  dialogueDrafts: readonly ParsedDialogueDraft[] = [],
): Pack {
  if (drafts.length === 0 && dialogueDrafts.length === 0 && !extras) {
    throw new DraftError([{ file: '(none)', message: 'no drafts given' }]);
  }
  if (drafts.length === 0 && dialogueDrafts.length === 0 && extras && !extras.pack) {
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

  // Pack meta must be identical across all drafts of a multi-draft pack.
  const metas: { file: string; pack: ParsedDraft['frontmatter']['pack'] }[] = [
    ...drafts.map((d) => ({ file: d.file, pack: d.frontmatter.pack })),
    ...dialogueDrafts.map((d) => ({ file: d.file, pack: d.frontmatter.pack })),
  ];
  const first = metas[0];
  const packMetaJson = JSON.stringify(first ? first.pack : extras!.pack);
  for (const m of metas.slice(1)) {
    if (JSON.stringify(m.pack) !== packMetaJson) {
      issues.push({
        file: m.file,
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

  // Unique story/dialogue ids per pack, unique sentence ids pack-wide
  // (dialogue node and choice ids double as their sentence ids).
  const storyIds = new Map<string, string>();
  const sentenceIds = new Map<string, { file: string; line: number }>();
  const claimSentenceId = (file: string, id: string, line: number) => {
    const seen = sentenceIds.get(id);
    if (seen !== undefined) {
      issues.push({
        file,
        line,
        message: `duplicate sentence id "${id}" (already used at ${seen.file}:${seen.line}) — sentence ids are unique pack-wide`,
      });
    }
    sentenceIds.set(id, { file, line });
  };
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
    for (const s of d.sentences) claimSentenceId(d.file, s.id, s.line);
  }
  const dialogueIds = new Map<string, string>();
  for (const d of dialogueDrafts) {
    const did = d.frontmatter.dialogue.id;
    const seenIn = dialogueIds.get(did);
    if (seenIn !== undefined) {
      issues.push({
        file: d.file,
        line: 2,
        message: `duplicate dialogue id "${did}" (already used in ${seenIn})`,
      });
    }
    dialogueIds.set(did, d.file);
    for (const n of d.nodes) {
      claimSentenceId(d.file, n.sentence.id, n.line);
      if (n.terminator?.kind === 'choices') {
        for (const c of n.terminator.choices) claimSentenceId(d.file, c.sentence.id, c.line);
      }
    }
  }

  const stories: Story[] = drafts.map((d) => ({
    id: d.frontmatter.story.id,
    title: d.frontmatter.story.title,
    level: d.frontmatter.story.level,
    sentences: d.sentences.map((s) => assembleSentence(d.file, s, issues)),
    audio: [], // audio tracks are attached by T09's `pipeline audio`
  }));
  const dialogues: Dialogue[] = dialogueDrafts.map((d) => assembleDialogue(d, issues));

  const meta = first ? first.pack : extras!.pack!;
  const pack: Pack = {
    id: meta.id,
    version: meta.version,
    type: meta.type,
    title: meta.title,
    level: meta.level,
    tags: meta.tags,
    stories,
  };
  if (dialogues.length > 0) pack.dialogues = dialogues;
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
