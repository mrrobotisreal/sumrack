import type {
  DialogueCharacter,
  DialogueEndingRow,
  DialogueGraph,
  DialogueGraphChoice,
  DialogueGraphNode,
  DialogueRunPath,
} from '@/db/repositories/dialogues';

/**
 * The dialogue run engine (T27, design V2 §3.3) — pure functions, no RN/DB
 * imports, fully unit-tested. A run's state is derived, never stored: the
 * `dialogue_runs.pathJson` steps (T26's exact Zod shape) replayed against the
 * T26 graph rebuild the full transcript, the current node, and the ending —
 * which is what makes force-close resume free.
 *
 * Resume semantics (T27 recorded decision): **resume-in-place.** Opening a
 * dialogue with an unfinished run rebuilds its transcript and continues at
 * the last visited node (whose line replays). A path that no longer resolves
 * against the installed graph (pack updated/replaced mid-run) is `stale`:
 * the old run is left as-is (unfinished, never deleted) and the caller
 * starts a fresh run.
 *
 * Walk model (T25 recorded decision): choices live ON the node awaiting the
 * answer. One path step per visited node; `choiceId`/`score` on a step
 * record how that node was LEFT (score present = spoken, absent = tapped).
 */

/** One visited node — an NPC line, or a scripted player line. */
export interface NodeEntry {
  kind: 'node';
  key: string;
  node: DialogueGraphNode;
}

/** The player's answer that left a choice-point node. */
export interface ChoiceEntry {
  kind: 'choice';
  key: string;
  /** The choice-point node this answered. */
  nodeId: string;
  choice: DialogueGraphChoice;
  /** ASR match score when spoken; undefined = tap-chosen. */
  score?: number;
}

export type TranscriptEntry = NodeEntry | ChoiceEntry;

export type EngineStatus = 'active' | 'finished' | 'stale';

export interface EngineState {
  status: EngineStatus;
  /** Full transcript in walk order (node lines + player answers). */
  entries: TranscriptEntry[];
  /** The node the run currently sits on (null when stale/empty path). */
  current: DialogueGraphNode | null;
  /** Resolved ending row once the walk reached an ending node. */
  ending: DialogueEndingRow | null;
}

export function nodeById(graph: DialogueGraph, nodeId: string): DialogueGraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

export function endingById(graph: DialogueGraph, endingId: string): DialogueEndingRow | undefined {
  return graph.endings.find((e) => e.id === endingId);
}

export function characterById(
  graph: DialogueGraph,
  characterId: string,
): DialogueCharacter | undefined {
  return graph.dialogue.characters.find((c) => c.id === characterId);
}

/**
 * Replay a run path against the graph. Any unresolvable step (missing node,
 * missing choice, or a choice stamped on a non-choice node) ⇒ `stale` —
 * precise per-step trust, so a pack update can never render garbage.
 *
 * `finished` (from `dialogue_runs.finishedAt`) marks a completed run whose
 * ending screen should re-render; the ending also resolves for an active
 * run sitting on an ending node (the finish write is the caller's job).
 */
export function buildEngineState(
  graph: DialogueGraph,
  path: DialogueRunPath,
  opts: { finished?: boolean } = {},
): EngineState {
  const entries: TranscriptEntry[] = [];
  let current: DialogueGraphNode | null = null;

  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i]!;
    const node = nodeById(graph, step.nodeId);
    if (!node) return { status: 'stale', entries: [], current: null, ending: null };
    entries.push({ kind: 'node', key: `step-${i}`, node });
    current = node;

    if (step.choiceId !== undefined) {
      if (node.kind !== 'choices') {
        return { status: 'stale', entries: [], current: null, ending: null };
      }
      const choice = node.choices.find((c) => c.id === step.choiceId);
      if (!choice) return { status: 'stale', entries: [], current: null, ending: null };
      entries.push({
        kind: 'choice',
        key: `step-${i}-choice`,
        nodeId: node.id,
        choice,
        score: step.score,
      });
    }
  }

  if (!current) return { status: 'stale', entries: [], current: null, ending: null };

  const ending =
    current.kind === 'ending' && current.endingId != null
      ? (endingById(graph, current.endingId) ?? null)
      : null;
  // A run stamped finished whose ending no longer resolves is stale too.
  if (opts.finished && !ending) {
    return { status: 'stale', entries: [], current: null, ending: null };
  }

  return { status: opts.finished ? 'finished' : 'active', entries, current, ending };
}

/** Stats the finish write + analytics need, derived from the path. */
export interface RunPathStats {
  /** Choice points answered (steps carrying a choiceId). */
  choiceCount: number;
  /** Answers given by voice (steps carrying a score). */
  spokenCount: number;
  /** Spoken answers of Hard-or-better quality (score ≥ 50) — the
   *  game_sessions `correctCount` (T27 recorded semantics). */
  spokenCorrectCount: number;
  /** Mean spoken score, null when nothing was spoken. */
  avgScore: number | null;
}

export const SPOKEN_CORRECT_MIN_SCORE = 50;

export function runPathStats(path: DialogueRunPath): RunPathStats {
  const answered = path.steps.filter((s) => s.choiceId !== undefined);
  const scores = answered.map((s) => s.score).filter((s): s is number => s !== undefined);
  return {
    choiceCount: answered.length,
    spokenCount: scores.length,
    spokenCorrectCount: scores.filter((s) => s >= SPOKEN_CORRECT_MIN_SCORE).length,
    avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  };
}
