import {
  NUDGE_KINDS,
  SCENARIO_MAX_BRANCHES,
  SCENARIO_MAX_LINES_PER_TURN,
  SCENARIO_MAX_TURNS,
  PLAYER_CHARACTER_ID,
  analyzeDialogueGraph,
  scenarioGraphInput,
  slotBranchKeys,
  slotFormIssue,
  type Expectation,
  type GlossaryEntry,
  type Nudge,
  type Scenario,
  type ScenarioCharacter,
  type ScenarioLine,
  type ScenarioTurn,
  type Sentence,
  type Slot,
} from '@sumrak/schema';
import type { DraftIssue } from './errors.ts';
import type { DraftSentence } from './draft.ts';
import type { ParsedScenarioDraft } from './scenario-draft.ts';
import { mergeTranslit, transliterate } from './translit.ts';

/**
 * Scenario assembly (T56): a parsed `*.scenario.md` → a `Scenario` (SCENARIOS
 * §2.1). Mirrors `assembleDialogue` in assemble.ts: every check that can
 * carry a draft line number happens here — speaker/target/branch-key
 * resolution, bounds, duplicate ids, the graph properties via the
 * `scenarioGraphInput` adapter — so authors get `file:line:` errors; the
 * shared schema's path-precise refinements remain the backstop. Glossary
 * `translit` = the draft's hand extras + `transliterate(en)` candidates.
 */

export type SentenceAssembler = (
  file: string,
  draft: DraftSentence,
  issues: DraftIssue[],
) => Sentence;

/** The characters as they reach pack.json: render-time `cues` stripped (T57 reads them from the draft). */
function castOf(draft: ParsedScenarioDraft): ScenarioCharacter[] {
  return draft.frontmatter.characters.map(({ cues: _cues, ...character }) => character);
}

export function assembleScenario(
  draft: ParsedScenarioDraft,
  issues: DraftIssue[],
  assembleSentence: SentenceAssembler,
): Scenario {
  const { file, frontmatter } = draft;
  const meta = frontmatter.scenario;
  const cast = castOf(draft);
  const castIds = new Set(cast.map((c) => c.id));
  const host = cast.find((c) => c.role === 'host');
  const endingIds = new Set(frontmatter.endings.map((e) => e.id));
  const turnIds = new Set(draft.turns.map((t) => t.id));
  const before = issues.length;

  const line = (s: DraftSentence): ScenarioLine => ({
    sentence: assembleSentence(file, s, issues),
  });

  const checkSpeaker = (speakerId: string | undefined, at: number, what: string) => {
    if (speakerId === undefined) return;
    if (!castIds.has(speakerId)) {
      issues.push({
        file,
        line: at,
        message: `${what} SPEAKER "${speakerId}" is not in the characters list (${[...castIds].join(', ')})`,
      });
    } else if (speakerId === PLAYER_CHARACTER_ID) {
      issues.push({
        file,
        line: at,
        message: `${what} speaks as "${PLAYER_CHARACTER_ID}" — the player never has scripted lines in a scenario`,
      });
    }
  };

  // --- cast sanity with frontmatter line numbers -------------------------
  const hosts = cast.filter((c) => c.role === 'host').length;
  if (hosts !== 1) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter characters: exactly one character must have role "host" (found ${hosts})`,
    });
  }
  if (!cast.some((c) => c.id === PLAYER_CHARACTER_ID && c.role === 'player')) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter characters: the reserved "${PLAYER_CHARACTER_ID}" character with role "player" is required`,
    });
  }

  if (draft.turns.length > SCENARIO_MAX_TURNS) {
    issues.push({
      file,
      line: draft.turns[SCENARIO_MAX_TURNS]!.line,
      message: `scenario "${meta.id}" has ${draft.turns.length} turns — the maximum is ${SCENARIO_MAX_TURNS}`,
    });
  }

  // --- turns ---------------------------------------------------------------
  const seenTurns = new Map<string, number>();
  const turns: ScenarioTurn[] = draft.turns.map((dt) => {
    const seenAt = seenTurns.get(dt.id);
    if (seenAt !== undefined) {
      issues.push({
        file,
        line: dt.line,
        message: `duplicate turn id "${dt.id}" (already used at ${file}:${seenAt})`,
      });
    }
    seenTurns.set(dt.id, dt.line);
    checkSpeaker(dt.speakerId, dt.speakerLine ?? dt.line, `turn "${dt.id}"`);
    if (dt.say.length > SCENARIO_MAX_LINES_PER_TURN) {
      issues.push({
        file,
        line: dt.line,
        message: `turn "${dt.id}" has ${dt.say.length} SAY lines — the maximum is ${SCENARIO_MAX_LINES_PER_TURN}`,
      });
    }

    const turn: ScenarioTurn = {
      id: dt.id,
      speakerId: dt.speakerId ?? '',
      say: dt.say.map(line),
    };

    // Expectation.
    const slotById = new Map<string, Slot>();
    if (dt.expect !== undefined) {
      const slots: Slot[] = [];
      for (const ds of dt.expect.slots) {
        if (slotById.has(ds.id)) {
          issues.push({
            file,
            line: ds.line,
            message: `duplicate slot id "${ds.id}" in turn "${dt.id}"`,
          });
        }
        let slot: Slot;
        if (ds.kind === 'forms') {
          const keys = new Set<string>();
          for (const opt of ds.options ?? []) {
            if (keys.has(opt.key)) {
              issues.push({
                file,
                line: ds.line,
                message: `duplicate option key "${opt.key}" in slot "${ds.id}" of turn "${dt.id}"`,
              });
            }
            keys.add(opt.key);
            if (ds.acceptsNumber && opt.key === 'number') {
              issues.push({
                file,
                line: ds.line,
                message: `slot "${ds.id}": option key "number" is reserved for the "| number" numeral branch`,
              });
            }
            for (const form of opt.forms) {
              const problem = slotFormIssue(form);
              if (problem !== null) {
                issues.push({
                  file,
                  line: ds.line,
                  message: `slot "${ds.id}" option "${opt.key}": ${problem}`,
                });
              }
            }
          }
          slot = {
            kind: 'forms',
            id: ds.id,
            required: ds.required,
            options: (ds.options ?? []).map((o) => ({
              key: o.key,
              lemma: o.lemma,
              forms: o.forms,
            })),
            acceptsNumber: ds.acceptsNumber ?? false,
          };
        } else if (ds.kind === 'free') {
          slot = { kind: 'free', id: ds.id, required: ds.required, minTokens: ds.minTokens ?? 1 };
          if (ds.cues !== undefined) slot.cues = ds.cues;
        } else {
          slot = { kind: 'number', id: ds.id, required: ds.required };
        }
        slotById.set(ds.id, slot);
        slots.push(slot);
      }
      const expect: Expectation = {
        slots,
        accept: dt.expect.accept?.texts ?? [],
      };
      if (dt.expect.branchOn !== undefined) {
        const target = slotById.get(dt.expect.branchOn.id);
        if (target === undefined) {
          issues.push({
            file,
            line: dt.expect.branchOn.line,
            message: `branchOn "${dt.expect.branchOn.id}" is not a slot of turn "${dt.id}" (slots: ${[...slotById.keys()].join(', ')})`,
          });
        } else if (target.kind === 'free') {
          issues.push({
            file,
            line: dt.expect.branchOn.line,
            message: `branchOn "${target.id}" is a free slot — only forms/number slots expose branch keys`,
          });
        }
        expect.branchOn = dt.expect.branchOn.id;
      }
      if (dt.expect.reject.length > 0) {
        expect.reject = dt.expect.reject.map((r) => {
          const group: NonNullable<Expectation['reject']>[number] = { forms: r.forms };
          if (r.react !== undefined) group.react = line(r.react);
          return group;
        });
      }
      turn.expect = expect;
    }

    // Retry.
    if (dt.retry !== undefined) {
      const r = dt.retry;
      // The parser already reported missing confused/hint/lifeline; assemble what exists.
      if (r.confused !== undefined && r.hint !== undefined && r.lifeline !== undefined) {
        turn.retry = {
          confused: line(r.confused),
          hint: line(r.hint),
          lifeline: { ru: r.lifeline.ru, en: r.lifeline.en },
        };
        if (r.second !== undefined) turn.retry.second = line(r.second);
      }
    }

    // Terminator.
    const term = dt.terminator;
    if (term?.kind === 'next') {
      if (!turnIds.has(term.target)) {
        issues.push({
          file,
          line: term.line,
          message: `turn "${dt.id}" NEXT target "${term.target}" is not a turn in this draft`,
        });
      }
      turn.next = term.target;
    } else if (term?.kind === 'branch') {
      if (term.on.length > SCENARIO_MAX_BRANCHES) {
        issues.push({
          file,
          line: term.line,
          message: `turn "${dt.id}" branches on ${term.on.length} keys — the maximum is ${SCENARIO_MAX_BRANCHES}`,
        });
      }
      const on: Record<string, string> = {};
      const seenKeys = new Set<string>();
      for (const { key, target } of term.on) {
        if (seenKeys.has(key)) {
          issues.push({
            file,
            line: term.line,
            message: `turn "${dt.id}" NEXT: on … repeats key "${key}"`,
          });
        }
        seenKeys.add(key);
        if (!turnIds.has(target)) {
          issues.push({
            file,
            line: term.line,
            message: `turn "${dt.id}" NEXT on ${key}=${target}: "${target}" is not a turn in this draft`,
          });
        }
        on[key] = target;
      }
      if (!turnIds.has(term.default)) {
        issues.push({
          file,
          line: term.line,
          message: `turn "${dt.id}" NEXT default "${term.default}" is not a turn in this draft`,
        });
      }
      const branchOnId = dt.expect?.branchOn?.id;
      if (dt.expect === undefined || branchOnId === undefined) {
        issues.push({
          file,
          line: term.line,
          message: `turn "${dt.id}" branches with "NEXT: on …" but its EXPECT: has no "branchOn: <slot-id>"`,
        });
      } else {
        const slot = slotById.get(branchOnId);
        if (slot !== undefined && slot.kind !== 'free') {
          const allowed = slotBranchKeys(slot);
          for (const key of seenKeys) {
            if (!allowed.includes(key)) {
              issues.push({
                file,
                line: term.line,
                message: `turn "${dt.id}" NEXT on key "${key}" is not a branch key of slot "${slot.id}" (allowed: ${allowed.join(', ')})`,
              });
            }
          }
        }
      }
      turn.next = { on, default: term.default };
    } else if (term?.kind === 'ending') {
      if (!endingIds.has(term.target)) {
        issues.push({
          file,
          line: term.line,
          message: `turn "${dt.id}" ENDING "${term.target}" is not defined in the endings frontmatter (${[...endingIds].join(', ')})`,
        });
      }
      turn.endingId = term.target;
    }
    return turn;
  });

  const startTurnId = meta.startTurnId ?? draft.turns[0]?.id ?? '';
  if (!turnIds.has(startTurnId)) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter scenario.startTurnId "${startTurnId}" is not a turn in this draft`,
    });
  }

  // --- glossary --------------------------------------------------------------
  const seenGlossaryIds = new Map<string, number>();
  const seenHeadwords = new Map<string, number>();
  const glossary: GlossaryEntry[] = draft.glossary.map((g) => {
    const idAt = seenGlossaryIds.get(g.id);
    if (idAt !== undefined) {
      issues.push({
        file,
        line: g.line,
        message: `duplicate glossary id "${g.id}" (already used at ${file}:${idAt}) — add "| id: <slug>" to one of the entries`,
      });
    }
    seenGlossaryIds.set(g.id, g.line);
    const ruKey = g.ru.toLowerCase();
    const ruAt = seenHeadwords.get(ruKey);
    if (ruAt !== undefined) {
      issues.push({
        file,
        line: g.line,
        message: `duplicate glossary headword "${g.ru}" (already used at ${file}:${ruAt})`,
      });
    }
    seenHeadwords.set(ruKey, g.line);
    const translit = mergeTranslit(transliterate(g.en), g.translit);
    if (translit.length === 0) {
      issues.push({
        file,
        line: g.line,
        message: `glossary entry "${g.ru}": no transliteration could be generated for "${g.en}" — add "| translit: <cyrillic>"`,
      });
    }
    const entry: GlossaryEntry = {
      id: g.id,
      ru: g.ru,
      en: g.en,
      forms: g.forms,
      translit,
      // Missing blocks were reported by the parser; a placeholder keeps the shape.
      explain:
        g.explain !== undefined ? line(g.explain) : { sentence: emptySentence(`${g.id}-ex`) },
      howToSay:
        g.howToSay !== undefined ? line(g.howToSay) : { sentence: emptySentence(`${g.id}-how`) },
    };
    return entry;
  });

  // --- nudges -------------------------------------------------------------------
  const seenNudges = new Map<string, number>();
  const nudges: Nudge[] = draft.nudges.map((n) => {
    const at = seenNudges.get(n.kind);
    if (at !== undefined) {
      issues.push({
        file,
        line: n.line,
        message: `duplicate nudge "### ${n.kind}" (already defined at ${file}:${at})`,
      });
    }
    seenNudges.set(n.kind, n.line);
    checkSpeaker(n.speakerId, n.speakerLine ?? n.line, `nudge "${n.kind}"`);
    return {
      kind: n.kind,
      speakerId: n.speakerId ?? host?.id ?? '',
      line: line(n.sentence),
    };
  });
  for (const kind of NUDGE_KINDS) {
    if (!seenNudges.has(kind)) {
      issues.push({
        file,
        message: `scenario "${meta.id}" has no "### ${kind}" nudge — the "## nudges" section needs one of each: ${NUDGE_KINDS.join(', ')}`,
      });
    }
  }

  const scenario: Scenario = {
    id: meta.id,
    familyId: meta.familyId,
    title: meta.title,
    level: meta.level,
    language: meta.language ?? 'ru',
    brief: meta.brief,
    cast,
    scene: frontmatter.scene,
    startTurnId,
    turns,
    endings: frontmatter.endings,
    glossary,
    nudges,
  };

  // Graph properties — only when every reference resolved.
  if (issues.length === before) {
    const analysis = analyzeDialogueGraph(scenarioGraphInput(scenario));
    const lineOf = new Map(draft.turns.map((t) => [t.id, t.line]));
    for (const id of analysis.unreachable) {
      issues.push({
        file,
        line: lineOf.get(id),
        message: `turn "${id}" is unreachable from the start turn "${startTurnId}" — dead branch`,
      });
    }
    for (const id of analysis.deadTraps) {
      issues.push({
        file,
        line: lineOf.get(id),
        message: `turn "${id}" can never reach an ending (dead trap — every cycle needs an exit path to an ending)`,
      });
    }
    for (const id of analysis.unreferencedEndings) {
      issues.push({
        file,
        line: 2,
        message: `ending "${id}" is never referenced by any turn — point a turn's ENDING: at it or delete it`,
      });
    }
  }

  return scenario;
}

/** Shape-only stand-in for a block the parser already reported as missing (never survives to output). */
function emptySentence(id: string): Sentence {
  return { id, ru: '—', en: '—', tokens: [{ text: '—', isPunct: true }] };
}
