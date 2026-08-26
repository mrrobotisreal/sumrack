import { describe, expect, it } from 'vitest';

import type { PackRow } from '@/db/repositories/content';

import { buildUnitState, type BuildPathInput } from '../path-model';
import { HOUSE_ROOMS, isHouseUnit, orderHouseUnits, roomForScene } from '../house-map/rooms';

/** T30: the data-driven room registry the house map (and T31's scenes) key off. */

function unitFor(id: string, themeScene: string | null): ReturnType<typeof buildUnitState> {
  const pack: PackRow = {
    id,
    version: 1,
    type: 'course-unit',
    titleRu: `Т-${id}`,
    titleEn: `T-${id}`,
    level: 'A1',
    tags: [],
    importedAt: 0,
    origin: 'remote',
    themeScene,
    themeAccent: null,
    track: null,
  };
  const input: Omit<BuildPathInput, 'packs' | 'checkpointResults'> = {
    stories: [],
    storyProgress: [],
    unitProgress: [],
    lemmaStats: {},
  };
  return buildUnitState(pack, input);
}

describe('house rooms registry', () => {
  it('holds the six §5.1 rooms in order, hallway down to the cellar', () => {
    expect(HOUSE_ROOMS.map((r) => r.scene)).toEqual([
      'hallway',
      'living-room',
      'kitchen',
      'pantry',
      'nursery',
      'cellar',
    ]);
    expect(HOUSE_ROOMS[5]!.belowGround).toBe(true);
  });

  it('detects house units; unknown scenes and unthemed packs are NOT house units', () => {
    expect(isHouseUnit({ themeScene: 'kitchen' })).toBe(true);
    expect(isHouseUnit({ themeScene: 'greenhouse' })).toBe(false); // forward-compat fallback
    expect(isHouseUnit({ themeScene: null })).toBe(false);
    expect(roomForScene('pantry')?.titleRu).toBe('Кладовая');
    expect(roomForScene('greenhouse')).toBeNull();
  });

  it('orders floors by room order, then pack id (prologue stacks above a shared scene)', () => {
    const ordered = orderHouseUnits([
      unitFor('a1-course-unit-092', 'cellar'),
      unitFor('a1-course-unit-091', 'kitchen'),
      unitFor('a1-course-unit-090', 'hallway'),
      // the «Тихий дом» retrofit case: an earlier pack id sharing a scene
      unitFor('a1-course-unit-001', 'hallway'),
    ]);
    expect(ordered.map((u) => u.pack.id)).toEqual([
      'a1-course-unit-001',
      'a1-course-unit-090',
      'a1-course-unit-091',
      'a1-course-unit-092',
    ]);
  });
});
