import { XP_TABLE } from '@/features/motivation/xp';

/**
 * The hotel's XP for a finished run (T90, decision 8). Pure. A unit pays only
 * on its first pass; a floor or экстерн pays on every pass (the first pass of
 * a floor is what unlocks it, a retake of a passed floor is practice and pays
 * nothing). Check answers and fails earn zero.
 */
export function hotelRunXp(input: {
  kind: 'unit' | 'floor' | 'extern';
  passed: boolean;
  firstPass: boolean;
}): number {
  if (!input.passed) return 0;
  switch (input.kind) {
    case 'unit':
      return input.firstPass ? XP_TABLE.hotelUnitPassed : 0;
    case 'floor':
      return input.firstPass ? XP_TABLE.hotelFloorPassed : 0;
    case 'extern':
      return input.firstPass ? XP_TABLE.hotelExternPassed : 0;
  }
}
