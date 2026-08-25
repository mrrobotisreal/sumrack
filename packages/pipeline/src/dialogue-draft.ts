import {
  CefrLevelSchema,
  CharacterSchema,
  EndingSchema,
  LocalizedTextSchema,
  StableIdSchema,
} from '@sumrak/schema';
import YAML from 'yaml';
import { parseFrontmatterWith, splitFrontmatter } from './draft.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import { PackMetaSchema } from './frontmatter.ts';
import { SentenceBlockCollector, type DraftSentence } from './sentence-block.ts';
import { z } from 'zod';

/**
 * Dialogue draft parser (T25): one `*.dialogue.md` file = one dialogue.
 * Frontmatter carries `pack:` + `dialogue:` meta + the `characters:` and
 * `endings:` lists; the body is scene blocks in script form:
 *
 * ```
 * ## <node-id>
 * SPEAKER: <characterId>
 * RU: … / EN: … / GRAMMAR: … + token table   (the T08 sentence block, reused)
 * NEXT: <node-id>            ← or ENDING: <ending-id>, or:
 * CHOICES:
 * ### <choice-id> -> <node-id>
 * RU/EN + token table
 * ALT: <alternate phrasing>          (repeatable → asrAlternates)
 * HINT: <ru nudge> | <en nudge>      (optional)
 * ```
 *
 * Ids double as sentence ids (node id → node sentence id, choice id → choice
 * sentence id), which is how draft-authored packs keep sentence ids pack-wide
 * unique. All T08 error conventions hold: collected errors, `file:line:`,
 * derived isPunct/spaceBefore, NFC, ё preserved.
 */

/** `dialogue:` frontmatter section. `startNodeId` defaults to the first scene block. */
export const DialogueMetaSchema = z.strictObject({
  id: StableIdSchema,
  title: LocalizedTextSchema,
  level: CefrLevelSchema,
  startNodeId: StableIdSchema.optional(),
});
export type DialogueMeta = z.infer<typeof DialogueMetaSchema>;

export const DialogueFrontmatterSchema = z.strictObject({
  pack: PackMetaSchema,
  dialogue: DialogueMetaSchema,
  characters: z.array(CharacterSchema).min(1),
  endings: z.array(EndingSchema).min(1),
});
export type DialogueFrontmatter = z.infer<typeof DialogueFrontmatterSchema>;

export interface DraftChoiceAlt {
  line: number;
  text: string;
}

/** One `### <choice-id> -> <node-id>` block under `CHOICES:`. */
export interface DraftDialogueChoice {
  /** 1-based line of the `###` heading. */
  line: number;
  id: string;
  /** The `-> <node-id>` branch target. */
  targetId: string;
  /** The player's line (sentence id = choice id). */
  sentence: DraftSentence;
  alts: DraftChoiceAlt[];
  hint?: { line: number; ru: string; en: string };
}

export type DraftNodeTerminator =
  | { kind: 'next'; target: string; line: number }
  | { kind: 'ending'; target: string; line: number }
  | { kind: 'choices'; line: number; choices: DraftDialogueChoice[] };

/** One `## <node-id>` scene block. */
export interface DraftDialogueNode {
  /** 1-based line of the `##` heading. */
  line: number;
  id: string;
  speakerId?: string;
  speakerLine?: number;
  /** The spoken line (sentence id = node id). */
  sentence: DraftSentence;
  terminator?: DraftNodeTerminator;
}

/** A fully parsed dialogue draft file. */
export interface ParsedDialogueDraft {
  file: string;
  frontmatter: DialogueFrontmatter;
  nodes: DraftDialogueNode[];
}

/**
 * Decide which parser a draft belongs to by peeking at its frontmatter keys:
 * a `dialogue:` section marks a dialogue draft, anything else is a story
 * draft (whose parser reports the real errors). Filename is deliberately not
 * the signal — content is.
 */
export function sniffDraftKind(file: string, source: string): 'story' | 'dialogue' {
  const { fmText } = splitFrontmatter(file, source);
  try {
    const raw: unknown = YAML.parse(fmText);
    if (raw !== null && typeof raw === 'object' && 'dialogue' in raw) return 'dialogue';
  } catch {
    // not even YAML — the story parser will report it
  }
  return 'story';
}

const CHOICE_HEADING = /^###\s+(.+)$/;
const CHOICE_HEADING_FULL = /^###\s+(\S+)\s+->\s+(\S+)$/;
const NODE_KEY = /^(SPEAKER|NEXT|ENDING|ALT|HINT|CHOICES):\s*(.*)$/;

/** Split a `HINT: ru | en` value on its unescaped `|` (same `\|` escape as tables). */
function splitHint(value: string): string[] {
  const ESC = '\u0000';
  return value
    .replaceAll('\\|', ESC)
    .split('|')
    .map((part) => part.replaceAll(ESC, '|').trim());
}

interface OpenChoice {
  choice: DraftDialogueChoice;
  collector: SentenceBlockCollector;
}

interface OpenNode {
  node: DraftDialogueNode;
  collector: SentenceBlockCollector;
  /** Set once CHOICES: was seen (choices then live on the terminator). */
  inChoices: boolean;
  openChoice: OpenChoice | null;
}

/**
 * Parse one dialogue draft file's text. Collects every issue it can find;
 * throws {@link DraftError} if any were found.
 */
export function parseDialogueDraft(file: string, source: string): ParsedDialogueDraft {
  const issues: DraftIssue[] = [];
  const { fmText, lines, fmEnd } = splitFrontmatter(file, source);
  const frontmatter = parseFrontmatterWith(file, fmText, DialogueFrontmatterSchema, issues);

  const nodes: DraftDialogueNode[] = [];
  let open: OpenNode | null = null;

  const closeChoice = (cur: OpenNode) => {
    if (!cur.openChoice) return;
    cur.openChoice.collector.finish();
    cur.openChoice = null;
  };

  const closeNode = () => {
    if (!open) return;
    const cur = open;
    closeChoice(cur);
    cur.collector.finish();
    if (cur.node.speakerId === undefined) {
      issues.push({
        file,
        line: cur.node.line,
        message: `node "${cur.node.id}" has no SPEAKER: line`,
      });
    }
    if (cur.node.terminator === undefined) {
      issues.push({
        file,
        line: cur.node.line,
        message: `node "${cur.node.id}" needs exactly one of NEXT:, ENDING:, or CHOICES: after its token table`,
      });
    } else if (cur.node.terminator.kind === 'choices' && cur.node.terminator.choices.length === 0) {
      issues.push({
        file,
        line: cur.node.terminator.line,
        message: `CHOICES: of node "${cur.node.id}" has no "### <choice-id> -> <node-id>" entries`,
      });
    }
    nodes.push(cur.node);
    open = null;
  };

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i]!;
    const line = raw.trim();

    if (line === '') continue;
    if (line.startsWith('<!--') && line.endsWith('-->')) continue; // comment
    if (/^#\s/.test(line)) continue; // decorative H1 (dialogue title) — ignored

    const choiceHeading = CHOICE_HEADING.exec(line);
    const nodeHeading = choiceHeading ? null : /^##\s+(.+)$/.exec(line);

    if (nodeHeading) {
      if (/^#{4,}\s/.test(line)) {
        issues.push({
          file,
          line: lineNo,
          message: 'only "##" node and "###" choice headings are allowed (no deeper levels)',
        });
        continue;
      }
      closeNode();
      const id = nodeHeading[1]!.trim().normalize('NFC');
      open = {
        node: {
          line: lineNo,
          id,
          sentence: undefined as unknown as DraftSentence, // set right below
        },
        collector: new SentenceBlockCollector(file, issues, lineNo, id, `node "${id}"`),
        inChoices: false,
        openChoice: null,
      };
      open.node.sentence = open.collector.sentence;
      continue;
    }

    if (!open) {
      issues.push({
        file,
        line: lineNo,
        message: `unexpected content before the first "## <node-id>" heading: "${line}"`,
      });
      continue;
    }
    const cur: OpenNode = open;

    if (choiceHeading) {
      if (!cur.inChoices) {
        issues.push({
          file,
          line: lineNo,
          message: `"###" choice headings are only allowed after a CHOICES: line (node "${cur.node.id}")`,
        });
        continue;
      }
      const full = CHOICE_HEADING_FULL.exec(line);
      if (!full) {
        issues.push({
          file,
          line: lineNo,
          message: `choice heading must be "### <choice-id> -> <node-id>", got: "${line}"`,
        });
        continue;
      }
      closeChoice(cur);
      const id = full[1]!.normalize('NFC');
      const targetId = full[2]!.normalize('NFC');
      const collector = new SentenceBlockCollector(file, issues, lineNo, id, `choice "${id}"`);
      const choice: DraftDialogueChoice = {
        line: lineNo,
        id,
        targetId,
        sentence: collector.sentence,
        alts: [],
      };
      (cur.node.terminator as { kind: 'choices'; choices: DraftDialogueChoice[] }).choices.push(
        choice,
      );
      cur.openChoice = { choice, collector };
      continue;
    }

    const key = NODE_KEY.exec(line);
    if (key) {
      const keyword = key[1]!;
      const value = key[2]!.trim().normalize('NFC');
      const setTerminator = (t: DraftNodeTerminator) => {
        if (cur.node.terminator !== undefined) {
          issues.push({
            file,
            line: lineNo,
            message: `node "${cur.node.id}" already has ${cur.node.terminator.kind === 'choices' ? 'CHOICES:' : cur.node.terminator.kind === 'next' ? 'NEXT:' : 'ENDING:'} — a node has exactly one of NEXT:, ENDING:, or CHOICES:`,
          });
          return;
        }
        cur.node.terminator = t;
      };
      switch (keyword) {
        case 'SPEAKER': {
          if (cur.inChoices || cur.openChoice) {
            issues.push({
              file,
              line: lineNo,
              message:
                'SPEAKER: belongs to the node, before its sentence — choices always speak as the player',
            });
            break;
          }
          if (cur.node.speakerId !== undefined) {
            issues.push({ file, line: lineNo, message: 'duplicate SPEAKER: line' });
            break;
          }
          if (value === '') {
            issues.push({ file, line: lineNo, message: 'SPEAKER: line is empty' });
            break;
          }
          cur.node.speakerId = value;
          cur.node.speakerLine = lineNo;
          break;
        }
        case 'NEXT':
        case 'ENDING': {
          if (cur.inChoices || cur.openChoice) {
            issues.push({
              file,
              line: lineNo,
              message: `${keyword}: is not allowed inside CHOICES: — a choice's target is the "-> <node-id>" in its heading`,
            });
            break;
          }
          if (value === '') {
            issues.push({ file, line: lineNo, message: `${keyword}: line is empty` });
            break;
          }
          setTerminator(
            keyword === 'NEXT'
              ? { kind: 'next', target: value, line: lineNo }
              : { kind: 'ending', target: value, line: lineNo },
          );
          break;
        }
        case 'CHOICES': {
          if (value !== '') {
            issues.push({
              file,
              line: lineNo,
              message:
                'CHOICES: takes no value — the choices follow as "### <choice-id> -> <node-id>" blocks',
            });
            break;
          }
          setTerminator({ kind: 'choices', line: lineNo, choices: [] });
          if (cur.node.terminator?.kind === 'choices') cur.inChoices = true;
          break;
        }
        case 'ALT': {
          if (!cur.openChoice) {
            issues.push({
              file,
              line: lineNo,
              message: 'ALT: is only allowed inside a "### <choice-id> -> <node-id>" block',
            });
            break;
          }
          if (value === '') {
            issues.push({ file, line: lineNo, message: 'ALT: line is empty' });
            break;
          }
          cur.openChoice.choice.alts.push({ line: lineNo, text: value });
          break;
        }
        case 'HINT': {
          if (!cur.openChoice) {
            issues.push({
              file,
              line: lineNo,
              message: 'HINT: is only allowed inside a "### <choice-id> -> <node-id>" block',
            });
            break;
          }
          if (cur.openChoice.choice.hint !== undefined) {
            issues.push({ file, line: lineNo, message: 'duplicate HINT: line' });
            break;
          }
          const parts = splitHint(value);
          if (parts.length !== 2 || parts.some((p) => p === '')) {
            issues.push({
              file,
              line: lineNo,
              message: 'HINT: must be "<ru nudge> | <en nudge>" (escape a literal | as \\|)',
            });
            break;
          }
          cur.openChoice.choice.hint = { line: lineNo, ru: parts[0]!, en: parts[1]! };
          break;
        }
      }
      continue;
    }

    // Sentence-block content goes to the open choice when one is open,
    // otherwise to the node's own sentence.
    if (cur.openChoice) {
      if (cur.openChoice.collector.tryLine(raw, line, lineNo)) continue;
    } else if (cur.inChoices) {
      issues.push({
        file,
        line: lineNo,
        message: `content after CHOICES: must start with a "### <choice-id> -> <node-id>" heading: "${line}"`,
      });
      continue;
    } else if (cur.collector.tryLine(raw, line, lineNo)) {
      continue;
    }

    issues.push({
      file,
      line: lineNo,
      message: `unrecognized line (expected "## <node-id>", "SPEAKER:", "RU:", "EN:", "GRAMMAR:", a "|" table row, "NEXT:", "ENDING:", "CHOICES:", "### <choice-id> -> <node-id>", "ALT:", "HINT:", or a blank line): "${line}"`,
    });
  }
  closeNode();

  if (nodes.length === 0) {
    issues.push({ file, message: 'dialogue draft has no scene blocks ("## <node-id>")' });
  }
  if (issues.length > 0) throw new DraftError(issues);

  return { file, frontmatter: frontmatter as DialogueFrontmatter, nodes };
}
