import {
  CefrLevelSchema,
  EndingSchema,
  LocalizedTextSchema,
  NUDGE_KINDS,
  ScenarioCharacterSchema,
  ScenarioSceneSchema,
  StableIdSchema,
  type NudgeKind,
} from '@sumrak/schema';
import { z } from 'zod';
import { parseFrontmatterWith, splitFrontmatter } from './draft.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import { PackMetaSchema } from './frontmatter.ts';
import { SentenceBlockCollector, type DraftSentence } from './sentence-block.ts';

/**
 * Scenario draft parser (T56, SPEAKING_SCENARIOS §2.3): one `*.scenario.md`
 * file = one blind speaking scenario. Frontmatter carries `pack:` +
 * `scenario:` meta, the `characters:` cast (T25 shape + `role`, `portrait`,
 * render-time `cues`), the `scene:` and the `endings:`; the body is turn
 * blocks, a `## glossary` section and a `## nudges` section:
 *
 * ```
 * ## <turn-id>
 * SPEAKER: <characterId>
 * SAY:                        ← 1–3 times; each opens one sentence block
 * RU: … / EN: … / GRAMMAR: … + token table
 * EXPECT:                     ← makes this a prompting turn (RETRY: then required)
 *   slot <id> <required|optional> forms: key=lemma: form, form* | key=… | number
 *   slot <id> <required|optional> free [minTokens=N] [cues="…, …"]
 *   slot <id> <required|optional> number
 *   accept: <paraphrase> | <paraphrase>
 *   branchOn: <slot-id>
 *   reject: <form>, <form> [-> REACT:]   ← REACT: opens a sentence block
 * RETRY:
 *   CONFUSED: / HINT: / SECOND:          ← each opens a sentence block
 *   LIFELINE: <ru> | <en>
 * NEXT: <turn-id>  |  NEXT: on k=<turn-id> … default=<turn-id>  |  ENDING: <ending-id>
 *
 * ## glossary
 * ### <ru> | <en> | forms: … [| translit: …] [| id: <slug>]
 * EXPLAIN: / HOWTOSAY:                   ← each opens a sentence block
 *
 * ## nudges
 * ### silence | which-word | dont-know
 * [SPEAKER: <characterId>]               ← defaults to the host
 * <sentence block>
 * ```
 *
 * **Sentence-id convention** (recorded here; AUTHORING.md repeats it): the
 * turn id is the id of its LAST say line, earlier say lines are `<turn>-a`,
 * `<turn>-b`; retry lines `<turn>-conf` / `-hint` / `-sec`; reject reactions
 * `<turn>-react`, `-react-2`, …; glossary clips `<scenario>-gl-<slug>-ex` /
 * `-how` where `<slug>` is the entry id (from the `en` text unless `id:` is
 * given); nudges `<scenario>-nudge-<kind>`. All of them join the pack-wide
 * sentence-id namespace. Every T08 error convention holds: collected errors,
 * `file:line:`, derived isPunct/spaceBefore, NFC, ё preserved.
 */

/** `scenario:` frontmatter section. `startTurnId` defaults to the first turn block. */
export const ScenarioMetaSchema = z.strictObject({
  id: StableIdSchema,
  familyId: StableIdSchema,
  title: LocalizedTextSchema,
  level: CefrLevelSchema,
  language: z.enum(['ru', 'uk']).optional(),
  brief: LocalizedTextSchema,
  startTurnId: StableIdSchema.optional(),
});
export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

/**
 * Render-time steering cues per character (T57 consumes them for the
 * confused/hint variants; `annotate` parses and carries them, never emits
 * them into pack.json — exactly like a story draft's `voice:` directions).
 */
export const CharacterCuesSchema = z.strictObject({
  confused: z.string().min(1).optional(),
  hint: z.string().min(1).optional(),
});
export type CharacterCues = z.infer<typeof CharacterCuesSchema>;

export const ScenarioDraftCharacterSchema = ScenarioCharacterSchema.extend({
  cues: CharacterCuesSchema.optional(),
});
export type ScenarioDraftCharacter = z.infer<typeof ScenarioDraftCharacterSchema>;

export const ScenarioFrontmatterSchema = z.strictObject({
  pack: PackMetaSchema,
  scenario: ScenarioMetaSchema,
  characters: z.array(ScenarioDraftCharacterSchema).min(2),
  scene: ScenarioSceneSchema,
  endings: z.array(EndingSchema).min(1),
});
export type ScenarioFrontmatter = z.infer<typeof ScenarioFrontmatterSchema>;

export interface DraftSlotOption {
  key: string;
  lemma: string;
  forms: string[];
}

export interface DraftSlot {
  line: number;
  id: string;
  required: boolean;
  kind: 'forms' | 'free' | 'number';
  options?: DraftSlotOption[];
  acceptsNumber?: boolean;
  minTokens?: number;
  cues?: string[];
}

export interface DraftReject {
  line: number;
  forms: string[];
  react?: DraftSentence;
}

export interface DraftExpect {
  line: number;
  slots: DraftSlot[];
  accept?: { line: number; texts: string[] };
  branchOn?: { line: number; id: string };
  reject: DraftReject[];
}

export interface DraftRetry {
  line: number;
  confused?: DraftSentence;
  hint?: DraftSentence;
  second?: DraftSentence;
  lifeline?: { line: number; ru: string; en: string };
}

export type DraftTurnTerminator =
  | { kind: 'next'; target: string; line: number }
  | { kind: 'branch'; on: { key: string; target: string }[]; default: string; line: number }
  | { kind: 'ending'; target: string; line: number };

/** One `## <turn-id>` block. */
export interface DraftScenarioTurn {
  /** 1-based line of the `##` heading. */
  line: number;
  id: string;
  speakerId?: string;
  speakerLine?: number;
  /** 1–3 say lines; ids assigned at close (`-a`, `-b`, …, `<id>`). */
  say: DraftSentence[];
  expect?: DraftExpect;
  retry?: DraftRetry;
  terminator?: DraftTurnTerminator;
}

/** One `### <ru> | <en> | forms: … | translit: …` glossary block. */
export interface DraftGlossaryEntry {
  line: number;
  /** Entry id (`<scenario>-gl-<slug>`); its clips are `<id>-ex` / `<id>-how`. */
  id: string;
  ru: string;
  en: string;
  forms: string[];
  /** Hand-written translit extras (merged with the generated candidates at assembly). */
  translit: string[];
  explain?: DraftSentence;
  howToSay?: DraftSentence;
}

export interface DraftNudge {
  line: number;
  kind: NudgeKind;
  speakerId?: string;
  speakerLine?: number;
  sentence: DraftSentence;
}

export interface ParsedScenarioDraft {
  file: string;
  frontmatter: ScenarioFrontmatter;
  turns: DraftScenarioTurn[];
  glossary: DraftGlossaryEntry[];
  nudges: DraftNudge[];
}

/** Every sentence block of a parsed scenario draft, in the fixed line order (for pack-wide id claims). */
export function draftScenarioSentences(draft: ParsedScenarioDraft): DraftSentence[] {
  const out: DraftSentence[] = [];
  for (const t of draft.turns) {
    out.push(...t.say);
    if (t.retry?.confused) out.push(t.retry.confused);
    if (t.retry?.hint) out.push(t.retry.hint);
    if (t.retry?.second) out.push(t.retry.second);
    for (const r of t.expect?.reject ?? []) if (r.react) out.push(r.react);
  }
  for (const g of draft.glossary) {
    if (g.explain) out.push(g.explain);
    if (g.howToSay) out.push(g.howToSay);
  }
  for (const n of draft.nudges) out.push(n.sentence);
  return out;
}

/** kebab-case slug of an English gloss («to hear» → `to-hear`). */
export function slugifyEn(en: string): string {
  return en
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split on unescaped `|` (same `\|` escape as tables), trimming each part. */
function splitPipes(value: string): string[] {
  const ESC = '\u0000';
  return value
    .replaceAll('\\|', ESC)
    .split('|')
    .map((part) => part.replaceAll(ESC, '|').trim());
}

function splitCommas(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

const TURN_KEY =
  /^(SPEAKER|SAY|EXPECT|RETRY|NEXT|ENDING|CONFUSED|HINT|SECOND|LIFELINE|EXPLAIN|HOWTOSAY):\s*(.*)$/;
const EXPECT_KEY = /^(slot)\s+(.*)$|^(accept|branchOn|reject):\s*(.*)$/i;
const SLOT_HEAD = /^(\S+)\s+(required|optional)\s+(forms|free|number)\b\s*:?\s*(.*)$/;
const GLOSSARY_HEADING = /^###\s+(.+)$/;

type Section = 'turns' | 'glossary' | 'nudges';

interface OpenTurn {
  turn: DraftScenarioTurn;
  /** Which construct the next sentence-block lines belong to. */
  collector: SentenceBlockCollector | null;
  /** 'expect' / 'retry' once the respective keyword opened; keys are only valid inside. */
  mode: 'body' | 'expect' | 'retry';
}

/**
 * Parse one scenario draft file's text. Collects every issue it can find;
 * throws {@link DraftError} if any were found.
 */
export function parseScenarioDraft(file: string, source: string): ParsedScenarioDraft {
  const issues: DraftIssue[] = [];
  const { fmText, lines, fmEnd } = splitFrontmatter(file, source);
  const frontmatter = parseFrontmatterWith(file, fmText, ScenarioFrontmatterSchema, issues);
  const scenarioId = frontmatter?.scenario.id ?? 'scenario';

  const turns: DraftScenarioTurn[] = [];
  const glossary: DraftGlossaryEntry[] = [];
  const nudges: DraftNudge[] = [];

  let section: Section = 'turns';
  let openTurn: OpenTurn | null = null;
  let openEntry: { entry: DraftGlossaryEntry; collector: SentenceBlockCollector | null } | null =
    null;
  let openNudge: {
    nudge: DraftNudge;
    collector: SentenceBlockCollector;
    /** False after an unknown "### <kind>" — the body is consumed, the nudge dropped. */
    valid: boolean;
  } | null = null;

  const closeTurn = () => {
    if (!openTurn) return;
    const { turn } = openTurn;
    openTurn.collector?.finish();
    // Say-line ids: the LAST line is the turn id, earlier lines get -a, -b, …
    turn.say.forEach((s, i) => {
      s.id = i === turn.say.length - 1 ? turn.id : `${turn.id}-${String.fromCharCode(97 + i)}`;
    });
    if (turn.speakerId === undefined) {
      issues.push({ file, line: turn.line, message: `turn "${turn.id}" has no SPEAKER: line` });
    }
    if (turn.say.length === 0) {
      issues.push({
        file,
        line: turn.line,
        message: `turn "${turn.id}" has no SAY: line — a turn speaks 1–3 sentence blocks, each opened by SAY:`,
      });
    }
    if (turn.expect !== undefined) {
      if (turn.expect.slots.length === 0) {
        issues.push({
          file,
          line: turn.expect.line,
          message: `EXPECT: of turn "${turn.id}" has no "slot …" lines`,
        });
      }
      if (turn.expect.accept === undefined) {
        issues.push({
          file,
          line: turn.expect.line,
          message: `EXPECT: of turn "${turn.id}" has no "accept:" line — the first paraphrase is the model answer`,
        });
      }
    }
    if (turn.retry !== undefined) {
      const r = turn.retry;
      if (r.confused === undefined)
        issues.push({
          file,
          line: r.line,
          message: `RETRY: of turn "${turn.id}" has no CONFUSED: block`,
        });
      if (r.hint === undefined)
        issues.push({
          file,
          line: r.line,
          message: `RETRY: of turn "${turn.id}" has no HINT: block`,
        });
      if (r.lifeline === undefined)
        issues.push({
          file,
          line: r.line,
          message: `RETRY: of turn "${turn.id}" has no LIFELINE: line`,
        });
    }
    if ((turn.expect === undefined) !== (turn.retry === undefined)) {
      issues.push({
        file,
        line: turn.expect?.line ?? turn.retry?.line ?? turn.line,
        message:
          turn.expect === undefined
            ? `turn "${turn.id}" has RETRY: but no EXPECT: — retry material belongs to a prompting turn`
            : `turn "${turn.id}" has EXPECT: but no RETRY: — every prompting turn needs CONFUSED:/HINT:/LIFELINE:`,
      });
    }
    if (turn.terminator === undefined) {
      issues.push({
        file,
        line: turn.line,
        message: `turn "${turn.id}" needs exactly one of NEXT: or ENDING: at its end`,
      });
    }
    turns.push(turn);
    openTurn = null;
  };

  const closeEntry = () => {
    if (!openEntry) return;
    openEntry.collector?.finish();
    const { entry } = openEntry;
    if (entry.explain === undefined)
      issues.push({
        file,
        line: entry.line,
        message: `glossary entry "${entry.ru}" has no EXPLAIN: block`,
      });
    if (entry.howToSay === undefined)
      issues.push({
        file,
        line: entry.line,
        message: `glossary entry "${entry.ru}" has no HOWTOSAY: block`,
      });
    glossary.push(entry);
    openEntry = null;
  };

  const closeNudge = () => {
    if (!openNudge) return;
    openNudge.collector.finish();
    if (openNudge.valid) nudges.push(openNudge.nudge);
    openNudge = null;
  };

  const closeAll = () => {
    closeTurn();
    closeEntry();
    closeNudge();
  };

  const openSayCollector = (cur: OpenTurn, lineNo: number) => {
    cur.collector?.finish();
    const n = cur.turn.say.length + 1;
    const collector = new SentenceBlockCollector(
      file,
      issues,
      lineNo,
      cur.turn.id,
      `SAY line ${n} of turn "${cur.turn.id}"`,
    );
    cur.turn.say.push(collector.sentence);
    cur.collector = collector;
  };

  const openNamedCollector = (
    cur: OpenTurn,
    lineNo: number,
    id: string,
    describe: string,
  ): DraftSentence => {
    cur.collector?.finish();
    const collector = new SentenceBlockCollector(file, issues, lineNo, id, describe);
    cur.collector = collector;
    return collector.sentence;
  };

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i]!;
    const line = raw.trim();

    if (line === '') continue;
    if (line.startsWith('<!--') && line.endsWith('-->')) continue; // comment
    if (/^#\s/.test(line)) continue; // decorative H1 — ignored

    // --- section / turn headings -----------------------------------------
    const h3 = GLOSSARY_HEADING.exec(line);
    const h2 = h3 ? null : /^##\s+(.+)$/.exec(line);
    if (h2) {
      if (/^#{4,}\s/.test(line)) {
        issues.push({
          file,
          line: lineNo,
          message:
            'only "##" turn/section and "###" glossary/nudge headings are allowed (no deeper levels)',
        });
        continue;
      }
      closeAll();
      const name = h2[1]!.trim().normalize('NFC');
      const lower = name.toLowerCase();
      if (lower === 'glossary' || lower === 'nudges') {
        section = lower;
        continue;
      }
      section = 'turns';
      const turn: DraftScenarioTurn = { line: lineNo, id: name, say: [] };
      openTurn = { turn, collector: null, mode: 'body' };
      continue;
    }

    if (h3) {
      const text = h3[1]!.trim().normalize('NFC');
      if (section === 'glossary') {
        closeEntry();
        const parts = splitPipes(text);
        const entry: DraftGlossaryEntry = {
          line: lineNo,
          id: '',
          ru: parts[0] ?? '',
          en: parts[1] ?? '',
          forms: [],
          translit: [],
        };
        if (parts.length < 3 || entry.ru === '' || entry.en === '') {
          issues.push({
            file,
            line: lineNo,
            message: `glossary heading must be "### <ru> | <en> | forms: <form>, <form*> [| translit: …] [| id: <slug>]", got: "${text}"`,
          });
        }
        let explicitId: string | undefined;
        for (const part of parts.slice(2)) {
          const kv = /^(forms|translit|id):\s*(.*)$/i.exec(part);
          if (!kv) {
            issues.push({
              file,
              line: lineNo,
              message: `glossary heading segment "${part}" must be "forms: …", "translit: …" or "id: …"`,
            });
            continue;
          }
          const key = kv[1]!.toLowerCase();
          if (key === 'forms') entry.forms = splitCommas(kv[2]!);
          else if (key === 'translit') entry.translit = splitCommas(kv[2]!);
          else explicitId = kv[2]!.trim();
        }
        if (entry.forms.length === 0 && parts.length >= 3) {
          issues.push({
            file,
            line: lineNo,
            message: `glossary entry "${entry.ru}" has no forms — list the surface forms/globs the learner might say`,
          });
        }
        const slug = explicitId ?? slugifyEn(entry.en);
        if (slug === '' || !StableIdSchema.safeParse(slug).success) {
          issues.push({
            file,
            line: lineNo,
            message: `glossary entry "${entry.ru}" needs an ASCII id — its English "${entry.en}" gives no kebab-case slug; add "| id: <slug>"`,
          });
        }
        entry.id = `${scenarioId}-gl-${slug}`;
        openEntry = { entry, collector: null };
        continue;
      }
      if (section === 'nudges') {
        closeNudge();
        const kind = NUDGE_KINDS.find((k) => k === text);
        if (kind === undefined) {
          issues.push({
            file,
            line: lineNo,
            message: `nudge heading must be one of ${NUDGE_KINDS.map((k) => `"### ${k}"`).join(', ')}, got: "${text}"`,
          });
        }
        const id = `${scenarioId}-nudge-${kind ?? 'unknown'}`;
        const collector = new SentenceBlockCollector(file, issues, lineNo, id, `nudge "${text}"`);
        openNudge = {
          nudge: { line: lineNo, kind: kind ?? 'silence', sentence: collector.sentence },
          collector,
          valid: kind !== undefined,
        };
        continue;
      }
      issues.push({
        file,
        line: lineNo,
        message: `"###" headings are only allowed inside "## glossary" or "## nudges" (got "${text}" in a turn)`,
      });
      continue;
    }

    // --- glossary body ----------------------------------------------------
    if (section === 'glossary') {
      if (!openEntry) {
        issues.push({
          file,
          line: lineNo,
          message: `content in "## glossary" must start with a "### <ru> | <en> | forms: …" heading: "${line}"`,
        });
        continue;
      }
      const key = TURN_KEY.exec(line);
      if (key && (key[1] === 'EXPLAIN' || key[1] === 'HOWTOSAY')) {
        if (key[2]!.trim() !== '') {
          issues.push({
            file,
            line: lineNo,
            message: `${key[1]}: takes no value — the sentence block (RU/EN + token table) follows on the next lines`,
          });
        }
        openEntry.collector?.finish();
        const field = key[1] === 'EXPLAIN' ? 'explain' : 'howToSay';
        if (openEntry.entry[field] !== undefined) {
          issues.push({
            file,
            line: lineNo,
            message: `duplicate ${key[1]}: block in glossary entry "${openEntry.entry.ru}"`,
          });
        }
        const id = `${openEntry.entry.id}-${field === 'explain' ? 'ex' : 'how'}`;
        const collector = new SentenceBlockCollector(
          file,
          issues,
          lineNo,
          id,
          `${key[1]}: of glossary entry "${openEntry.entry.ru}"`,
        );
        openEntry.entry[field] = collector.sentence;
        openEntry.collector = collector;
        continue;
      }
      if (openEntry.collector?.tryLine(raw, line, lineNo)) continue;
      issues.push({
        file,
        line: lineNo,
        message: `unrecognized glossary line (expected "### …", "EXPLAIN:", "HOWTOSAY:", "RU:", "EN:", "GRAMMAR:", a "|" table row, or a blank line): "${line}"`,
      });
      continue;
    }

    // --- nudges body -----------------------------------------------------
    if (section === 'nudges') {
      if (!openNudge) {
        issues.push({
          file,
          line: lineNo,
          message: `content in "## nudges" must start with a "### <kind>" heading: "${line}"`,
        });
        continue;
      }
      const key = TURN_KEY.exec(line);
      if (key && key[1] === 'SPEAKER') {
        const value = key[2]!.trim().normalize('NFC');
        if (openNudge.nudge.speakerId !== undefined) {
          issues.push({ file, line: lineNo, message: 'duplicate SPEAKER: line' });
        } else if (value === '') {
          issues.push({ file, line: lineNo, message: 'SPEAKER: line is empty' });
        } else {
          openNudge.nudge.speakerId = value;
          openNudge.nudge.speakerLine = lineNo;
        }
        continue;
      }
      if (openNudge.collector.tryLine(raw, line, lineNo)) continue;
      issues.push({
        file,
        line: lineNo,
        message: `unrecognized nudge line (expected "### <kind>", "SPEAKER:", "RU:", "EN:", "GRAMMAR:", a "|" table row, or a blank line): "${line}"`,
      });
      continue;
    }

    // --- turns body ------------------------------------------------------
    if (!openTurn) {
      issues.push({
        file,
        line: lineNo,
        message: `unexpected content before the first "## <turn-id>" heading: "${line}"`,
      });
      continue;
    }
    const cur: OpenTurn = openTurn;
    const turn = cur.turn;

    const key = TURN_KEY.exec(line);
    if (key) {
      const keyword = key[1]!;
      const value = key[2]!.trim().normalize('NFC');
      const noValue = (): boolean => {
        if (value === '') return true;
        issues.push({
          file,
          line: lineNo,
          message: `${keyword}: takes no value — the sentence block (RU/EN + token table) follows on the next lines`,
        });
        return false;
      };
      const setTerminator = (t: DraftTurnTerminator) => {
        if (turn.terminator !== undefined) {
          issues.push({
            file,
            line: lineNo,
            message: `turn "${turn.id}" already has ${turn.terminator.kind === 'ending' ? 'ENDING:' : 'NEXT:'} — a turn has exactly one of NEXT: or ENDING:`,
          });
          return;
        }
        turn.terminator = t;
      };
      switch (keyword) {
        case 'SPEAKER': {
          if (turn.speakerId !== undefined) {
            issues.push({ file, line: lineNo, message: 'duplicate SPEAKER: line' });
          } else if (value === '') {
            issues.push({ file, line: lineNo, message: 'SPEAKER: line is empty' });
          } else {
            turn.speakerId = value;
            turn.speakerLine = lineNo;
          }
          break;
        }
        case 'SAY': {
          if (cur.mode !== 'body') {
            issues.push({
              file,
              line: lineNo,
              message: `SAY: must come before EXPECT:/RETRY: in turn "${turn.id}"`,
            });
            break;
          }
          if (turn.terminator !== undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `SAY: after NEXT:/ENDING: in turn "${turn.id}" — the terminator closes the turn`,
            });
            break;
          }
          noValue();
          if (turn.say.length >= 3) {
            issues.push({
              file,
              line: lineNo,
              message: `turn "${turn.id}" has more than 3 SAY: lines — split it into two turns`,
            });
          }
          openSayCollector(cur, lineNo);
          break;
        }
        case 'EXPECT': {
          noValue();
          if (turn.expect !== undefined) {
            issues.push({ file, line: lineNo, message: `duplicate EXPECT: in turn "${turn.id}"` });
            break;
          }
          cur.collector?.finish();
          cur.collector = null;
          turn.expect = { line: lineNo, slots: [], reject: [] };
          cur.mode = 'expect';
          break;
        }
        case 'RETRY': {
          noValue();
          if (turn.retry !== undefined) {
            issues.push({ file, line: lineNo, message: `duplicate RETRY: in turn "${turn.id}"` });
            break;
          }
          cur.collector?.finish();
          cur.collector = null;
          turn.retry = { line: lineNo };
          cur.mode = 'retry';
          break;
        }
        case 'CONFUSED':
        case 'HINT':
        case 'SECOND': {
          if (cur.mode !== 'retry' || turn.retry === undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `${keyword}: is only allowed inside RETRY:`,
            });
            break;
          }
          noValue();
          const field =
            keyword === 'CONFUSED' ? 'confused' : keyword === 'HINT' ? 'hint' : 'second';
          if (turn.retry[field] !== undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `duplicate ${keyword}: in RETRY: of turn "${turn.id}"`,
            });
            break;
          }
          const suffix = field === 'confused' ? 'conf' : field === 'hint' ? 'hint' : 'sec';
          turn.retry[field] = openNamedCollector(
            cur,
            lineNo,
            `${turn.id}-${suffix}`,
            `${keyword}: of turn "${turn.id}"`,
          );
          break;
        }
        case 'LIFELINE': {
          if (cur.mode !== 'retry' || turn.retry === undefined) {
            issues.push({ file, line: lineNo, message: 'LIFELINE: is only allowed inside RETRY:' });
            break;
          }
          cur.collector?.finish();
          cur.collector = null;
          if (turn.retry.lifeline !== undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `duplicate LIFELINE: in RETRY: of turn "${turn.id}"`,
            });
            break;
          }
          const parts = splitPipes(value);
          if (parts.length !== 2 || parts.some((p) => p === '')) {
            issues.push({
              file,
              line: lineNo,
              message: 'LIFELINE: must be "<ru hint> | <en hint>" (escape a literal | as \\|)',
            });
            break;
          }
          turn.retry.lifeline = { line: lineNo, ru: parts[0]!, en: parts[1]! };
          break;
        }
        case 'NEXT':
        case 'ENDING': {
          cur.collector?.finish();
          cur.collector = null;
          cur.mode = 'body';
          if (value === '') {
            issues.push({ file, line: lineNo, message: `${keyword}: line is empty` });
            break;
          }
          if (keyword === 'ENDING') {
            setTerminator({ kind: 'ending', target: value, line: lineNo });
            break;
          }
          const words = value.split(/\s+/);
          if (words[0] !== 'on') {
            if (words.length !== 1) {
              issues.push({
                file,
                line: lineNo,
                message: `NEXT: must be "<turn-id>" or "on <key>=<turn-id> … default=<turn-id>", got: "${value}"`,
              });
              break;
            }
            setTerminator({ kind: 'next', target: value, line: lineNo });
            break;
          }
          const on: { key: string; target: string }[] = [];
          let dflt: string | undefined;
          let bad = false;
          for (const w of words.slice(1)) {
            const kv = /^([^=]+)=(.+)$/.exec(w);
            if (!kv) {
              issues.push({
                file,
                line: lineNo,
                message: `NEXT: on … expects "<key>=<turn-id>" pairs, got "${w}"`,
              });
              bad = true;
              continue;
            }
            if (kv[1] === 'default') dflt = kv[2]!;
            else on.push({ key: kv[1]!, target: kv[2]! });
          }
          if (dflt === undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `NEXT: on … needs a "default=<turn-id>" pair (the path taken when no key matched)`,
            });
            bad = true;
          }
          if (on.length === 0 && !bad) {
            issues.push({
              file,
              line: lineNo,
              message:
                'NEXT: on … has no "<key>=<turn-id>" pairs — use "NEXT: <turn-id>" for a linear turn',
            });
            bad = true;
          }
          if (!bad) setTerminator({ kind: 'branch', on, default: dflt!, line: lineNo });
          break;
        }
        case 'EXPLAIN':
        case 'HOWTOSAY': {
          issues.push({
            file,
            line: lineNo,
            message: `${keyword}: is only allowed inside a "## glossary" entry`,
          });
          break;
        }
      }
      continue;
    }

    // EXPECT sub-keys.
    if (cur.mode === 'expect' && turn.expect !== undefined) {
      const ek = EXPECT_KEY.exec(line);
      if (ek) {
        const expect = turn.expect;
        if (ek[1] !== undefined) {
          // slot <id> <required|optional> <kind> …
          cur.collector?.finish();
          cur.collector = null;
          const head = SLOT_HEAD.exec(ek[2]!.trim().normalize('NFC'));
          if (!head) {
            issues.push({
              file,
              line: lineNo,
              message: `slot line must be "slot <id> <required|optional> forms: … | free [minTokens=N] [cues=\\"…\\"] | number", got: "${line}"`,
            });
            continue;
          }
          const slot: DraftSlot = {
            line: lineNo,
            id: head[1]!,
            required: head[2] === 'required',
            kind: head[3] as DraftSlot['kind'],
          };
          const rest = head[4]!.trim();
          if (slot.kind === 'forms') {
            slot.options = [];
            slot.acceptsNumber = false;
            if (rest === '') {
              issues.push({
                file,
                line: lineNo,
                message: `forms slot "${slot.id}" has no options after "forms:"`,
              });
            }
            for (const seg of splitPipes(rest)) {
              if (seg === '') continue;
              if (seg === 'number') {
                slot.acceptsNumber = true;
                continue;
              }
              const eq = seg.indexOf('=');
              const colon = eq === -1 ? -1 : seg.indexOf(':', eq + 1);
              if (eq === -1 || colon === -1) {
                issues.push({
                  file,
                  line: lineNo,
                  message: `slot "${slot.id}" option "${seg}" must be "<key>=<lemma>: <form>, <form*>" (or the bare word "number")`,
                });
                continue;
              }
              const option: DraftSlotOption = {
                key: seg.slice(0, eq).trim(),
                lemma: seg.slice(eq + 1, colon).trim(),
                forms: splitCommas(seg.slice(colon + 1)),
              };
              if (option.key === '' || option.lemma === '' || option.forms.length === 0) {
                issues.push({
                  file,
                  line: lineNo,
                  message: `slot "${slot.id}" option "${seg}" needs a key, a lemma and at least one form`,
                });
                continue;
              }
              slot.options.push(option);
            }
          } else if (slot.kind === 'free') {
            for (const m of rest.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) {
              const k = m[1]!;
              const v = m[3] ?? m[2]!;
              if (k === 'minTokens') {
                const n = Number.parseInt(v, 10);
                if (!Number.isInteger(n) || n < 1) {
                  issues.push({
                    file,
                    line: lineNo,
                    message: `slot "${slot.id}" minTokens must be a positive integer, got "${v}"`,
                  });
                } else slot.minTokens = n;
              } else if (k === 'cues') {
                slot.cues = splitCommas(v);
              } else {
                issues.push({
                  file,
                  line: lineNo,
                  message: `slot "${slot.id}" free slot has an unknown option "${k}" (minTokens=N, cues="…")`,
                });
              }
            }
          } else if (rest !== '') {
            issues.push({
              file,
              line: lineNo,
              message: `number slot "${slot.id}" takes no options, got "${rest}"`,
            });
          }
          expect.slots.push(slot);
          continue;
        }
        const sub = ek[3]!.toLowerCase();
        const value = ek[4]!.trim().normalize('NFC');
        if (sub === 'accept') {
          cur.collector?.finish();
          cur.collector = null;
          if (expect.accept !== undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `duplicate accept: in EXPECT: of turn "${turn.id}"`,
            });
            continue;
          }
          const texts = splitPipes(value).filter((t) => t !== '');
          if (texts.length === 0) {
            issues.push({
              file,
              line: lineNo,
              message: 'accept: needs at least one paraphrase ("A. | B.")',
            });
            continue;
          }
          expect.accept = { line: lineNo, texts };
          continue;
        }
        if (sub === 'branchon') {
          cur.collector?.finish();
          cur.collector = null;
          if (expect.branchOn !== undefined) {
            issues.push({
              file,
              line: lineNo,
              message: `duplicate branchOn: in EXPECT: of turn "${turn.id}"`,
            });
            continue;
          }
          if (value === '') {
            issues.push({ file, line: lineNo, message: 'branchOn: line is empty' });
            continue;
          }
          expect.branchOn = { line: lineNo, id: value };
          continue;
        }
        // reject: <forms> [-> REACT:]
        cur.collector?.finish();
        cur.collector = null;
        const arrow = value.split('->');
        const forms = splitCommas(arrow[0]!);
        if (forms.length === 0) {
          issues.push({
            file,
            line: lineNo,
            message: 'reject: needs at least one form ("спасибо, хорошо")',
          });
          continue;
        }
        const reject: DraftReject = { line: lineNo, forms };
        if (arrow.length > 1) {
          const tail = arrow.slice(1).join('->').trim();
          if (!/^REACT:\s*$/.test(tail)) {
            issues.push({
              file,
              line: lineNo,
              message: `reject: may end in "-> REACT:" (then a sentence block follows), got "-> ${tail}"`,
            });
            continue;
          }
          const n = expect.reject.length + 1;
          const id = n === 1 ? `${turn.id}-react` : `${turn.id}-react-${n}`;
          reject.react = openNamedCollector(cur, lineNo, id, `REACT: of turn "${turn.id}"`);
        }
        expect.reject.push(reject);
        continue;
      }
    }

    // Sentence-block content goes to the open collector, if any.
    if (cur.collector?.tryLine(raw, line, lineNo)) continue;

    issues.push({
      file,
      line: lineNo,
      message:
        cur.mode === 'expect'
          ? `unrecognized line inside EXPECT: (expected "slot …", "accept:", "branchOn:", "reject:", a REACT sentence block, "RETRY:", "NEXT:", or "ENDING:"): "${line}"`
          : cur.mode === 'retry'
            ? `unrecognized line inside RETRY: (expected "CONFUSED:", "HINT:", "SECOND:", "LIFELINE:", a sentence block, "NEXT:", or "ENDING:"): "${line}"`
            : `unrecognized line (expected "## <turn-id>", "SPEAKER:", "SAY:", "RU:", "EN:", "GRAMMAR:", a "|" table row, "EXPECT:", "RETRY:", "NEXT:", "ENDING:", or a blank line): "${line}"`,
    });
  }
  closeAll();

  if (turns.length === 0) {
    issues.push({ file, message: 'scenario draft has no turn blocks ("## <turn-id>")' });
  }
  const nudgeKinds = new Set(nudges.map((n) => n.kind));
  for (const kind of NUDGE_KINDS) {
    if (!nudgeKinds.has(kind)) {
      issues.push({
        file,
        message: `scenario "${scenarioId}" has no "### ${kind}" nudge — the "## nudges" section needs one of each: ${NUDGE_KINDS.join(', ')}`,
      });
    }
  }
  if (issues.length > 0) throw new DraftError(issues);

  return { file, frontmatter: frontmatter as ScenarioFrontmatter, turns, glossary, nudges };
}
