import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import type {
  DialogueEndingRow,
  DialogueGraph,
  DialogueGraphChoice,
  DialogueRunPath,
  DialogueRunRow,
} from '@/db/repositories/dialogues';
import { useAchievementToasts } from '@/features/motivation/toast-store';
import { recordDialogueFinished } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { buildEngineState, runPathStats, type EngineState } from './engine';

/**
 * Run lifecycle for the dialogue player (T27): owns the `dialogue_runs` /
 * `game_sessions` writes and the finish side-effects (endings-seen via the
 * repo, XP + achievements via the motivation service, analytics, toast).
 * All graph *reading* is derived through the pure engine — the screen only
 * ever sees `EngineState`.
 *
 * Recorded decisions (T27):
 * - **Resume-in-place**: the newest unfinished run whose path still resolves
 *   against the installed graph is resumed (transcript rebuilt, current line
 *   replays). A stale path (pack changed mid-run) leaves the old row
 *   untouched and starts fresh.
 * - **Restart abandons in place**: the discarded run row is kept (finishedAt
 *   stays null, never resumed again because resume always takes the newest);
 *   its game_sessions row is closed with `abandoned: true` so no open rows
 *   dangle.
 * - **One game_sessions row per run**: created with `detail.runId` at run
 *   start; resume re-attaches to the open row by that id.
 */

export type RunPhase = 'loading' | 'error' | 'ready';

export interface FinishInfo {
  ending: DialogueEndingRow;
  newEnding: boolean;
}

interface UseDialogueRunResult {
  phase: RunPhase;
  engine: EngineState | null;
  run: DialogueRunRow | null;
  resumed: boolean;
  finishInfo: FinishInfo | null;
  /** Continue a linear node to its `next`. */
  advanceToNode: (nodeId: string) => Promise<void>;
  /** Branch on an answered choice (score present = spoken). */
  applyChoice: (choice: DialogueGraphChoice, score?: number) => Promise<void>;
  /** Persist the finish once the walk sits on an ending node. */
  finalize: () => Promise<void>;
  /** Discard the current run (kept in place) and start over. */
  restart: () => Promise<void>;
  retryInit: () => void;
}

function endingToastIcon(
  tone: DialogueEndingRow['tone'],
): 'flag' | 'skull-outline' | 'eye-outline' {
  if (tone === 'good') return 'flag';
  if (tone === 'bad') return 'skull-outline';
  return 'eye-outline';
}

export function useDialogueRun(
  packId: string | undefined,
  dialogueId: string | undefined,
  graph: DialogueGraph | null | undefined,
): UseDialogueRunResult {
  const queryClient = useQueryClient();
  const [phase, setPhase] = React.useState<RunPhase>('loading');
  const [run, setRun] = React.useState<DialogueRunRow | null>(null);
  const [path, setPath] = React.useState<DialogueRunPath | null>(null);
  const [resumed, setResumed] = React.useState(false);
  const [finishInfo, setFinishInfo] = React.useState<FinishInfo | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const sessionIdRef = React.useRef<string | null>(null);
  const advancingRef = React.useRef(false);
  const finalizedRef = React.useRef(false);

  const engine = React.useMemo(() => {
    if (!graph || !path) return null;
    return buildEngineState(graph, path);
  }, [graph, path]);

  React.useEffect(() => {
    if (!graph || !dialogueId) return;
    let cancelled = false;
    void (async () => {
      try {
        // Newest unfinished run whose path still replays cleanly → resume.
        const runs = await repos.dialogues.listRuns(dialogueId);
        let activeRun = runs.find((r) => r.finishedAt == null) ?? null;
        let activePath: DialogueRunPath | null = null;
        let didResume = false;
        if (activeRun) {
          try {
            const parsed = repos.dialogues.parseRunPath(activeRun);
            if (buildEngineState(graph, parsed).status === 'active') {
              activePath = parsed;
              didResume = true;
            }
          } catch {
            // Unparseable pathJson — treat as stale, start fresh.
          }
        }
        if (!activeRun || !activePath) {
          activeRun = await repos.dialogues.startRun(dialogueId, graph.dialogue.startNodeId);
          activePath = repos.dialogues.parseRunPath(activeRun);
          didResume = false;
        }

        // One game_sessions row per run: re-attach on resume, else create.
        let sessionId: string | null = null;
        if (didResume) {
          const sessions = await repos.stats.listGameSessions(100);
          sessionId =
            sessions.find(
              (s) =>
                s.mode === 'dialogue' &&
                s.endedAt == null &&
                typeof s.detail === 'object' &&
                s.detail !== null &&
                (s.detail as Record<string, unknown>).runId === activeRun!.id,
            )?.id ?? null;
        }
        if (!sessionId) {
          sessionId = (await repos.stats.startGameSession('dialogue', { runId: activeRun.id })).id;
        }

        if (cancelled) return;
        sessionIdRef.current = sessionId;
        finalizedRef.current = false;
        setRun(activeRun);
        setPath(activePath);
        setResumed(didResume);
        setFinishInfo(null);
        setPhase('ready');
        track('dialogue_run_started', { packId: packId ?? '', dialogueId, resumed: didResume });
      } catch (err) {
        if (cancelled) return;
        logError('manual', err);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, dialogueId, packId, attempt]);

  const advance = React.useCallback(
    async (nodeId: string, choice?: { choiceId: string; score?: number }) => {
      if (!run || advancingRef.current || finalizedRef.current) return;
      advancingRef.current = true;
      try {
        const next = await repos.dialogues.recordStep(run.id, { nodeId, ...choice });
        setPath(next);
      } catch (err) {
        logError('manual', err);
      } finally {
        advancingRef.current = false;
      }
    },
    [run],
  );

  const advanceToNode = React.useCallback((nodeId: string) => advance(nodeId), [advance]);

  const applyChoice = React.useCallback(
    (choice: DialogueGraphChoice, score?: number) =>
      advance(choice.nextNodeId, { choiceId: choice.id, score }),
    [advance],
  );

  const finalize = React.useCallback(async () => {
    if (!run || !path || !engine?.ending || finalizedRef.current || !dialogueId) return;
    finalizedRef.current = true;
    const ending = engine.ending;
    try {
      const stats = runPathStats(path);
      const { newEnding } = await repos.dialogues.finishRun(run.id, { endingId: ending.id });
      if (sessionIdRef.current) {
        await repos.stats.finishGameSession(sessionIdRef.current, {
          itemCount: stats.choiceCount,
          correctCount: stats.spokenCorrectCount,
          detail: {
            runId: run.id,
            endingId: ending.id,
            spokenCount: stats.spokenCount,
            avgScore: stats.avgScore == null ? null : Math.round(stats.avgScore),
          },
        });
      }
      if (newEnding) {
        // Collected endings behave like mini-achievements (V2 §3.3) — same
        // toast surface, ephemeral def (never persisted to `achievements`).
        useAchievementToasts.getState().push({
          id: `ending-${dialogueId}-${ending.id}`,
          title: 'Новая концовка',
          description: `«${ending.titleRu}» — ${ending.titleEn}`,
          icon: endingToastIcon(ending.tone),
        });
      }
      await recordDialogueFinished(newEnding);
      track('dialogue_ending_found', {
        dialogueId,
        endingId: ending.id,
        tone: ending.tone,
        newEnding,
      });
      track('dialogue_run_finished', {
        dialogueId,
        endingId: ending.id,
        newEnding,
        choiceCount: stats.choiceCount,
        spokenCount: stats.spokenCount,
        spokenCorrectCount: stats.spokenCorrectCount,
        ...(stats.avgScore == null ? {} : { avgScore: Math.round(stats.avgScore) }),
        durationMs: Date.now() - run.startedAt,
      });
      for (const key of [
        ['dialogues'],
        ['dialogue-runs'],
        ['daily-activity'],
        ['motivation'],
        ['achievements'],
        ['due-count'],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      setFinishInfo({ ending, newEnding });
    } catch (err) {
      finalizedRef.current = false;
      logError('manual', err);
    }
  }, [run, path, engine, dialogueId, queryClient]);

  const restart = React.useCallback(async () => {
    if (!graph || !dialogueId) return;
    try {
      if (run && run.finishedAt == null && !finalizedRef.current && path) {
        // Mid-run restart: abandon in place (row kept), close its session.
        const stats = runPathStats(path);
        track('dialogue_run_abandoned', { dialogueId, steps: path.steps.length });
        if (sessionIdRef.current) {
          await repos.stats.finishGameSession(sessionIdRef.current, {
            itemCount: stats.choiceCount,
            correctCount: stats.spokenCorrectCount,
            detail: { runId: run.id, abandoned: true },
          });
        }
      }
      const fresh = await repos.dialogues.startRun(dialogueId, graph.dialogue.startNodeId);
      const session = await repos.stats.startGameSession('dialogue', { runId: fresh.id });
      sessionIdRef.current = session.id;
      finalizedRef.current = false;
      setRun(fresh);
      setPath(repos.dialogues.parseRunPath(fresh));
      setResumed(false);
      setFinishInfo(null);
      void queryClient.invalidateQueries({ queryKey: ['dialogue-runs'] });
      track('dialogue_run_started', { packId: packId ?? '', dialogueId, resumed: false });
    } catch (err) {
      logError('manual', err);
    }
  }, [graph, dialogueId, packId, run, path, queryClient]);

  const retryInit = React.useCallback(() => {
    setPhase('loading');
    setAttempt((a) => a + 1);
  }, []);

  return {
    phase,
    engine,
    run,
    resumed,
    finishInfo,
    advanceToNode,
    applyChoice,
    finalize,
    restart,
    retryInit,
  };
}
