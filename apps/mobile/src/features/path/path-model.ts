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
 * T30 (V2 §6.1): the track a course-unit pack belongs to. ABSENT in the pack
 * (NULL column) = the main track — the default lives here at the app layer,
 * never in the schema or the DB, so pack JSON stays an honest record.
 */
export const MAIN_TRACK = 'main';

export function packTrack(pack: Pick<PackRow, 'track'>): string {
  return pack.track ?? MAIN_TRACK;
}

/**
 * App-known track display names (packs carry data, never presentation).
 * Unknown tracks render their raw id — forward-compatible like scenes.
 */
export const TRACK_TITLES: Record<string, { ru: string; en: string }> = {
  family: { ru: 'Семья', en: 'The family track' },
};

export function trackTitle(track: string): { ru: string; en: string } {
  return TRACK_TITLES[track] ?? { ru: track, en: track };
}

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

/**
 * One track section within a level (T30). Ordering rule (recorded decision):
 * `main` first, then other tracks in first-seen pack-id order (packs carry
 * no track-order field). Checkpoints are level-scoped, so they live at the
 * END of the `main` section — the checkpoint concludes the level.
 */
export interface PathTrackGroup {
  track: string;
  nodes: PathNode[];
}

export interface PathLevelGroup {
  level: PathLevelName;
  tracks: PathTrackGroup[];
}

export interface PathState {
  levels: PathLevelGroup[];
  /**
   * The node Today's continue card and the Path highlight point at. T30 rule
   * (recorded decision): the first incomplete node — in path order — of the
   * MOST RECENTLY TOUCHED track (touch = the max of `unit_progress.updatedAt`
   * and the unit's stories' `story_progress.updatedAt`, per track across all
   * levels; checkpoints count toward `main`). Falls back to the global first
   * incomplete node when that track is fully complete or nothing was ever
   * touched. Null when the path is done/empty.
   */
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
  storyProgress: Pick<StoryProgressRow, 'packId' | 'storyId' | 'finishedAt' | 'updatedAt'>[];
  unitProgress: Pick<
    UnitProgressRow,
    | 'packId'
    | 'lessonReadAt'
    | 'quizPassedAt'
    | 'quizBestScorePercent'
    | 'completedAt'
    | 'updatedAt'
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

/** The track a node credits toward (checkpoints are level-scoped → `main`). */
export function nodeTrack(node: PathNode): string {
  return node.kind === 'unit' ? packTrack(node.pack) : MAIN_TRACK;
}

function isIncomplete(node: PathNode): boolean {
  return node.kind === 'unit' ? !node.complete : !node.passed;
}

/**
 * Assemble the whole path. Within a level: track sections (`main` first,
 * then first-seen pack-id order), units before the level checkpoint(s) which
 * close the `main` section. Track completion is independent — grouping is
 * presentation; credit derivation (buildUnitState) never sees tracks.
 */
export function buildPathState(input: BuildPathInput): PathState {
  const levels: PathLevelGroup[] = [];
  let unitCount = 0;
  let checkpointCount = 0;

  for (const level of PATH_LEVELS) {
    const levelUnits = input.packs
      .filter((p) => p.level === level && p.type === 'course-unit')
      .sort((a, b) => a.id.localeCompare(b.id));
    const checkpoints = input.packs
      .filter((p) => p.level === level && p.type === 'checkpoint')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => buildCheckpointState(p, input.checkpointResults));
    unitCount += levelUnits.length;
    checkpointCount += checkpoints.length;

    // Track order: `main` first, then first-seen pack order (recorded rule).
    const trackOrder = [MAIN_TRACK];
    for (const pack of levelUnits) {
      const track = packTrack(pack);
      if (!trackOrder.includes(track)) trackOrder.push(track);
    }

    const tracks: PathTrackGroup[] = [];
    for (const track of trackOrder) {
      const nodes: PathNode[] = levelUnits
        .filter((p) => packTrack(p) === track)
        .map((p) => buildUnitState(p, input));
      if (track === MAIN_TRACK) nodes.push(...checkpoints);
      if (nodes.length > 0) tracks.push({ track, nodes });
    }
    if (tracks.length > 0) levels.push({ level, tracks });
  }

  const allNodes = levels.flatMap((l) => l.tracks.flatMap((t) => t.nodes));
  const firstIncomplete = allNodes.find(isIncomplete) ?? null;

  // Most-recently-touched track (see PathState.current doc for the rule).
  const unitTouchByPack = new Map<string, number>();
  for (const u of input.unitProgress) {
    unitTouchByPack.set(u.packId, Math.max(unitTouchByPack.get(u.packId) ?? 0, u.updatedAt));
  }
  for (const p of input.storyProgress) {
    unitTouchByPack.set(p.packId, Math.max(unitTouchByPack.get(p.packId) ?? 0, p.updatedAt));
  }
  let recentTrack: string | null = null;
  let recentAt = 0;
  for (const node of allNodes) {
    if (node.kind !== 'unit') continue;
    const touched = unitTouchByPack.get(node.pack.id) ?? 0;
    if (touched > recentAt) {
      recentAt = touched;
      recentTrack = nodeTrack(node);
    }
  }

  const current =
    (recentTrack != null
      ? allNodes.find((n) => nodeTrack(n) === recentTrack && isIncomplete(n))
      : null) ?? firstIncomplete;

  return { levels, current, unitCount, checkpointCount };
}
