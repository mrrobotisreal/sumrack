import type { PackRow, StoryRow } from '@/db/repositories/content';
import type { StoryProgressRow } from '@/db/repositories/reading';
import type { UnitLemmaStats, UnitProgressRow } from '@/db/repositories/path';

/**
 * Pure path assembly (T17, design §7.5). The path is a per-level sequence of
 * course units followed by that level's checkpoint, A1 → C1. Everything here
 * is DERIVED from content + user state — the model has no notion of "visited
 * the Path tab", which is what makes out-of-order Library usage credit units
 * for free. Nothing is ever locked: state is presentation, not permission.
 */

export const PATH_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type PathLevelName = (typeof PATH_LEVELS)[number];

/**
 * Review goal for a unit (recorded T17 decision): reviewing
 * `min(10, totalLemmas)` distinct unit lemmas (any direction, any entry
 * point) meets the unit's exercise goal. Collection happens by reading +
 * banking; reviews accrue from any session that grades the lemma's cards.
 */
export function unitGoalTarget(totalLemmas: number): number {
  return Math.min(10, totalLemmas);
}

export type UnitStepKind = 'lesson' | 'story' | 'goal' | 'quiz';

export interface UnitStoryState {
  storyId: string;
  titleRu: string;
  titleEn: string;
  started: boolean;
  finished: boolean;
}

export interface UnitState {
  kind: 'unit';
  pack: PackRow;
  stories: UnitStoryState[];
  lessonRead: boolean;
  goal: UnitLemmaStats & { target: number; met: boolean };
  quizPassed: boolean;
  quizBestScorePercent: number | null;
  /** First-completion stamp already persisted (celebration/analytics fired). */
  completedAtRecorded: boolean;
  stepsDone: number;
  stepsTotal: number;
  complete: boolean;
  /** The next uncompleted step, in canonical order; null when complete. */
  nextStep: UnitStepKind | null;
  /** For nextStep === 'story': which story. */
  nextStoryId: string | null;
}

export interface CheckpointState {
  kind: 'checkpoint';
  pack: PackRow;
  passed: boolean;
  bestScorePercent: number | null;
  attempts: number;
}

export type PathNode = UnitState | CheckpointState;

export interface PathLevelGroup {
  level: PathLevelName;
  nodes: PathNode[];
}

export interface PathState {
  levels: PathLevelGroup[];
  /** First incomplete node in path order (unit or checkpoint); null when done/empty. */
  current: PathNode | null;
  unitCount: number;
  checkpointCount: number;
}

export interface CheckpointResultLike {
  checkpointPackId: string;
  scorePercent: number;
  passed: boolean;
}

export interface BuildPathInput {
  /** course-unit + checkpoint packs (any order — sorted here). */
  packs: PackRow[];
  /** All stories of those packs (others are ignored). */
  stories: Pick<StoryRow, 'packId' | 'id' | 'orderIdx' | 'titleRu' | 'titleEn'>[];
  storyProgress: Pick<StoryProgressRow, 'packId' | 'storyId' | 'finishedAt'>[];
  unitProgress: Pick<
    UnitProgressRow,
    'packId' | 'lessonReadAt' | 'quizPassedAt' | 'quizBestScorePercent' | 'completedAt'
  >[];
  lemmaStats: Record<string, UnitLemmaStats>;
  checkpointResults: CheckpointResultLike[];
}

export function buildUnitState(
  pack: PackRow,
  input: Omit<BuildPathInput, 'packs' | 'checkpointResults'>,
): UnitState {
  const stories = input.stories
    .filter((s) => s.packId === pack.id)
    .sort((a, b) => a.orderIdx - b.orderIdx);
  const progressByStory = new Map(
    input.storyProgress.filter((p) => p.packId === pack.id).map((p) => [p.storyId, p]),
  );
  const storyStates: UnitStoryState[] = stories.map((s) => {
    const p = progressByStory.get(s.id);
    return {
      storyId: s.id,
      titleRu: s.titleRu,
      titleEn: s.titleEn,
      started: p != null,
      finished: p?.finishedAt != null,
    };
  });

  const unit = input.unitProgress.find((u) => u.packId === pack.id);
  const stats = input.lemmaStats[pack.id] ?? { totalLemmas: 0, collected: 0, reviewed: 0 };
  const target = unitGoalTarget(stats.totalLemmas);
  const goalMet = target > 0 ? stats.reviewed >= target : false;

  const lessonRead = unit?.lessonReadAt != null;
  const quizPassed = unit?.quizPassedAt != null;
  const storiesDone = storyStates.filter((s) => s.finished).length;

  // Canonical step order: lesson → stories → goal → quiz (design §7.5).
  const stepsTotal = 1 + storyStates.length + 1 + 1;
  const stepsDone = (lessonRead ? 1 : 0) + storiesDone + (goalMet ? 1 : 0) + (quizPassed ? 1 : 0);
  const complete = stepsDone === stepsTotal;

  let nextStep: UnitStepKind | null = null;
  let nextStoryId: string | null = null;
  if (!lessonRead) nextStep = 'lesson';
  else if (storiesDone < storyStates.length) {
    nextStep = 'story';
    nextStoryId = storyStates.find((s) => !s.finished)?.storyId ?? null;
  } else if (!goalMet) nextStep = 'goal';
  else if (!quizPassed) nextStep = 'quiz';

  return {
    kind: 'unit',
    pack,
    stories: storyStates,
    lessonRead,
    goal: { ...stats, target, met: goalMet },
    quizPassed,
    quizBestScorePercent: unit?.quizBestScorePercent ?? null,
    completedAtRecorded: unit?.completedAt != null,
    stepsDone,
    stepsTotal,
    complete,
    nextStep,
    nextStoryId,
  };
}

function buildCheckpointState(pack: PackRow, results: CheckpointResultLike[]): CheckpointState {
  const own = results.filter((r) => r.checkpointPackId === pack.id);
  const best = own.reduce<number | null>(
    (acc, r) => (acc == null || r.scorePercent > acc ? r.scorePercent : acc),
    null,
  );
  return {
    kind: 'checkpoint',
    pack,
    passed: own.some((r) => r.passed),
    bestScorePercent: best,
    attempts: own.length,
  };
}

/** Assemble the whole path. Units before checkpoints within a level. */
export function buildPathState(input: BuildPathInput): PathState {
  const levels: PathLevelGroup[] = [];
  let unitCount = 0;
  let checkpointCount = 0;

  for (const level of PATH_LEVELS) {
    const units = input.packs
      .filter((p) => p.level === level && p.type === 'course-unit')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => buildUnitState(p, input));
    const checkpoints = input.packs
      .filter((p) => p.level === level && p.type === 'checkpoint')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => buildCheckpointState(p, input.checkpointResults));
    unitCount += units.length;
    checkpointCount += checkpoints.length;
    const nodes: PathNode[] = [...units, ...checkpoints];
    if (nodes.length > 0) levels.push({ level, nodes });
  }

  const current =
    levels.flatMap((l) => l.nodes).find((n) => (n.kind === 'unit' ? !n.complete : !n.passed)) ??
    null;

  return { levels, current, unitCount, checkpointCount };
}
