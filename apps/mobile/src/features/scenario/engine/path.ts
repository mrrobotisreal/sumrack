import type { ScenarioDetail, ScenarioRunPath, ScenarioRunStep } from '@/db/repositories/scenarios';

import {
  freshCounters,
  initialState,
  resolveNext,
  turnById,
  type EngineGraph,
  type TurnState,
} from './turn-machine';

/**
 * Path replay + resume (T60, SPEAKING_SCENARIOS §7.3, T27 decision 2 —
 * resume-in-place): a run's `pathJson` (T58's `ScenarioRunPathSchema`)
 * replayed against the installed graph rebuilds where the run stands. Any
 * step that no longer resolves (missing turn, a branch key that does not
 * lead where the path went) ⇒ `stale`: the old run is left untouched and
 * the caller starts fresh.
 */

export type PathStatus = 'active' | 'finished' | 'stale';

export interface PathReplay {
  status: PathStatus;
  /** Turn ids in walk order (empty when stale). */
  visited: string[];
  /** The step the run currently sits on (its counters may be non-zero mid-turn). */
  current: ScenarioRunStep | null;
  endingId: string | null;
}

export function graphFromDetail(detail: ScenarioDetail): EngineGraph {
  const glossaryClips: Record<string, { explain: string; howToSay: string }> = {};
  for (const g of detail.glossary) {
    glossaryClips[g.id] = { explain: g.explainSentenceId, howToSay: g.howToSaySentenceId };
  }
  return {
    scenarioId: detail.scenario.id,
    startTurnId: detail.scenario.startTurnId,
    turns: detail.turns,
    nudges: detail.nudges.map((n) => ({ kind: n.kind, sentenceId: n.sentenceId })),
    glossaryClips,
  };
}

export function replayPath(
  graph: EngineGraph,
  path: ScenarioRunPath,
  opts: { finished?: boolean } = {},
): PathReplay {
  const stale: PathReplay = { status: 'stale', visited: [], current: null, endingId: null };
  if (path.steps.length === 0) return stale;
  if (path.steps[0]!.turnId !== graph.startTurnId) return stale;
  const visited: string[] = [];
  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i]!;
    const turn = turnById(graph, step.turnId);
    if (!turn) return stale;
    visited.push(step.turnId);
    const next = path.steps[i + 1];
    if (next) {
      // A skipped turn left along the default; a matched one along its branch key.
      const expected = resolveNext(turn, step.skipped ? null : (step.branchKey ?? null));
      if (expected !== next.turnId) return stale;
    }
  }
  const current = path.steps[path.steps.length - 1]!;
  const turn = turnById(graph, current.turnId)!;
  const endingId = turn.endingId ?? null;
  if (opts.finished && !endingId) return stale;
  return { status: opts.finished ? 'finished' : 'active', visited, current, endingId };
}

/** The machine state a resumed run starts from: the current turn with its persisted counters restored. */
export function resumeState(graph: EngineGraph, replay: PathReplay): TurnState | null {
  if (replay.status !== 'active' || !replay.current) return null;
  const c = replay.current;
  const base = initialState(graph, c.turnId);
  return {
    ...base,
    counters: {
      ...freshCounters(),
      misses: c.misses,
      assisted: c.assisted,
      skipped: c.skipped,
      rescued: c.rescued,
      meta: c.meta,
    },
    lifelineAvailable: c.misses >= 2,
    lifelineRevealed: c.assisted,
    skipAvailable: c.misses >= 3,
    totals: {
      answered: replay.visited.length - 1,
      clean: 0,
    },
  };
}
