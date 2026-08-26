import type { PackRow } from '@/db/repositories/content';

import type { UnitState } from '../path-model';

/**
 * The house room registry (T30, V2 §5.1) — the single data-driven mapping
 * from `theme.scene` to a floor of the house cross-section. T31's ambient
 * scene engine keys off the SAME scene ids; keep this array the one place
 * room identity lives. Order = §5.1 room order, top floor → cellar.
 *
 * Scenes outside this set are valid pack data (forward-compatible) — those
 * units simply render with the default path presentation.
 */
export interface RoomDef {
  /** `theme.scene` value this room matches. */
  scene: string;
  titleRu: string;
  titleEn: string;
  /** Drawn below the ground line (darker interior, hatched earth). */
  belowGround?: boolean;
}

export const HOUSE_ROOMS: readonly RoomDef[] = [
  { scene: 'hallway', titleRu: 'Прихожая', titleEn: 'The Entryway' },
  { scene: 'living-room', titleRu: 'Гостиная', titleEn: 'The Living Room' },
  { scene: 'kitchen', titleRu: 'Кухня', titleEn: 'The Kitchen' },
  { scene: 'pantry', titleRu: 'Кладовая', titleEn: 'The Pantry' },
  { scene: 'nursery', titleRu: 'Детская', titleEn: 'The Nursery' },
  { scene: 'cellar', titleRu: 'Подвал', titleEn: 'The Cellar', belowGround: true },
];

const ROOM_ORDER = new Map(HOUSE_ROOMS.map((room, i) => [room.scene, i]));

export function isHouseScene(scene: string | null | undefined): scene is string {
  return scene != null && ROOM_ORDER.has(scene);
}

export function isHouseUnit(pack: Pick<PackRow, 'themeScene'>): boolean {
  return isHouseScene(pack.themeScene);
}

export function roomForScene(scene: string): RoomDef | null {
  const idx = ROOM_ORDER.get(scene);
  return idx == null ? null : HOUSE_ROOMS[idx]!;
}

/**
 * Floors of the map, top → cellar: house-themed units sorted by §5.1 room
 * order, then pack id. Two units sharing a scene stack in pack-id order —
 * this is how the «Тихий дом» prologue sits above the entryway once its
 * retrofit pack version ships a house scene.
 */
export function orderHouseUnits(units: readonly UnitState[]): UnitState[] {
  return [...units].sort((a, b) => {
    const byRoom =
      (ROOM_ORDER.get(a.pack.themeScene ?? '') ?? 0) -
      (ROOM_ORDER.get(b.pack.themeScene ?? '') ?? 0);
    return byRoom !== 0 ? byRoom : a.pack.id.localeCompare(b.pack.id);
  });
}
