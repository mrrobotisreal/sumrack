import { useQuery, useQueryClient } from '@tanstack/react-query';

import { repos } from '@/db';
import type { UnitLemmaStats } from '@/db/repositories/path';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

import { buildPathState, type PathNode, type PathState, type UnitState } from './path-model';

export const pathQueryKey = ['path'] as const;

/**
 * Assemble the derived path state (T17). Runs the two idempotent
 * maintenance writes inline after assembly — deliberately in the fetch, not
 * in a screen effect, so that credit earned entirely outside the Path tab
 * (Library reading + review sessions — the out-of-order case) is stamped and
 * celebrated no matter which screen computes the path next (Path tab or
 * Today's continue card):
 *
 * 1. first-completion stamps (`unit_progress.completedAt`, fires
 *    `unit_completed` exactly once per unit);
 * 2. the `pathPosition` setting ({ level, packId }) that T15's journal
 *    prompt rotation reads for level-appropriate prompts.
 */
async function fetchPathState(): Promise<PathState> {
  const packs = await repos.path.listPathPacks();
  const [stories, storyProgress, unitProgress, checkpointResults] = await Promise.all([
    repos.content.listStories(),
    repos.reading.listProgress(),
    repos.path.listUnitProgress(),
    repos.stats.listCheckpointResults(),
  ]);

  const lemmaStats: Record<string, UnitLemmaStats> = {};
  const courseUnits = packs.filter((p) => p.type === 'course-unit');
  const statsList = await Promise.all(
    courseUnits.map((pack) => repos.path.getUnitLemmaStats(pack.id)),
  );
  courseUnits.forEach((pack, i) => {
    lemmaStats[pack.id] = statsList[i]!;
  });

  let state = buildPathState({
    packs,
    stories,
    storyProgress,
    unitProgress,
    lemmaStats,
    checkpointResults,
  });

  // (1) First-completion stamps.
  let stamped = false;
  for (const level of state.levels) {
    for (const trackGroup of level.tracks) {
      for (const node of trackGroup.nodes) {
        if (node.kind === 'unit' && node.complete && !node.completedAtRecorded) {
          const first = await repos.path.markUnitCompleted(node.pack.id);
          if (first) {
            stamped = true;
            track('unit_completed', { packId: node.pack.id, level: node.pack.level });
          }
        }
      }
    }
  }
  if (stamped) {
    const unitProgress2 = await repos.path.listUnitProgress();
    state = buildPathState({
      packs,
      stories,
      storyProgress,
      unitProgress: unitProgress2,
      lemmaStats,
      checkpointResults,
    });
  }

  // (2) pathPosition setting for prompt rotation + T18.
  if (state.current) {
    const position = {
      level: state.current.pack.level,
      packId: state.current.pack.id,
      kind: state.current.kind,
    };
    const prev = await repos.settings.get<{ packId?: string }>(SETTING_KEYS.pathPosition);
    if (prev?.packId !== position.packId) {
      await repos.settings.set(SETTING_KEYS.pathPosition, position);
      track('path_position_advanced', { packId: position.packId, level: position.level });
    }
  }

  return state;
}

export function usePathState() {
  return useQuery({ queryKey: pathQueryKey, queryFn: fetchPathState });
}

export function useInvalidatePath() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: pathQueryKey });
}

/** Human label + router target for a node's next step (Today's continue card). */
export function nextStepInfo(node: PathNode): { label: string; route: string } {
  if (node.kind === 'checkpoint') {
    return {
      label: 'Take the checkpoint test',
      route: `/path/checkpoint/${node.pack.id}`,
    };
  }
  const unit = node;
  switch (unit.nextStep) {
    case 'lesson':
      return { label: 'Read the grammar lesson', route: `/path/${unit.pack.id}/lesson` };
    case 'story': {
      const story = unit.stories.find((s) => s.storyId === unit.nextStoryId);
      return {
        label: story ? `Read «${story.titleRu}»` : 'Read the next story',
        route: `/reader/${unit.pack.id}/${unit.nextStoryId}?from=path`,
      };
    }
    case 'goal':
      return {
        label: `Review unit words (${unit.goal.reviewed}/${unit.goal.target})`,
        route: '/review/daily',
      };
    case 'quiz':
    default:
      return { label: 'Take the unit quiz', route: `/path/${unit.pack.id}/quiz` };
  }
}

export function isUnit(node: PathNode): node is UnitState {
  return node.kind === 'unit';
}
