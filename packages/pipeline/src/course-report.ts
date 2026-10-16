import type { Course, CourseItem, Pack } from '@sumrak/schema';

/**
 * The `course` validate report (T88, design HOTEL_PATH §2 decision 7): one
 * floor's lesson shape at a glance — cards per unit, voiced examples, the
 * scored pools by kind, the floor exam, the binary-option census, and the
 * items with no voice. AUTHORING AID ONLY: deterministic (declaration order)
 * and snapshot-tested, never parsed downstream. Warnings never change an exit
 * code; schema errors (which stop a pack before it gets here) do.
 *
 * The live-manifest checks (practice refs, library quote text) are NOT here:
 * they need the manifest and live in {@link courseManifestIssues}.
 */

/** TORFL bible §4.1.1 binary-option contrasts: the only pairs that may carry 2 options. */
export const BINARY_OPTION_SETS: readonly (readonly [string, string])[] = [
  ['не', 'нет'],
  ['в', 'на'],
  ['уже', 'ещё'],
  ['а', 'но'],
  ['слушать', 'слышать'],
  ['потому что', 'поэтому'],
];

const normalizeOpt = (s: string) => s.trim().toLowerCase().replaceAll('ё', 'е');

/** True when a two-option choice's options are one of the binary contrasts. */
export function isBinaryPair(options: readonly string[]): boolean {
  if (options.length !== 2) return false;
  const pair = options.map(normalizeOpt).sort();
  return BINARY_OPTION_SETS.some(
    ([a, b]) => [normalizeOpt(a), normalizeOpt(b)].sort().join('|') === pair.join('|'),
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Count every voiced example reference on one unit (explain + edge examples, trap rights). */
function unitVoicedExamples(course: Course, unitIndex: number): number {
  const unit = course.units[unitIndex]!;
  let n = 0;
  for (const card of unit.cards) {
    if (card.kind === 'explain' || card.kind === 'edge') n += card.examples.length;
  }
  return n;
}

export function renderCourseReport(pack: Pack): string {
  const course = pack.course;
  const items = pack.items ?? [];
  if (course === undefined) return '';
  const byId = new Map<string, CourseItem>(items.map((i) => [i.id, i]));
  const out: string[] = [];

  out.push(
    `Course report — ${pack.id} (${course.ladder} ${course.level}, floor ${course.floor} «${course.title.ru}»)`,
    `  ${plural(course.units.length, 'unit', 'units')} · ${plural(items.length, 'item', 'items')} · gate ${course.gate.passPercent}% / extern ${course.gate.extern.passPercent}%`,
  );

  course.units.forEach((unit, ui) => {
    const count = (kind: string) => unit.cards.filter((c) => c.kind === kind).length;
    const cards = ['explain', 'check', 'traps', 'edge', 'library']
      .map((k) => `${k} ${count(k)}`)
      .join(' · ');
    const pool = unit.exercises.pool.map((id) => byId.get(id)).filter((i): i is CourseItem => !!i);
    const byKind = (kind: CourseItem['kind']) => pool.filter((i) => i.kind === kind).length;
    out.push(
      '',
      `  ${unit.id} «${unit.title.ru}»`,
      `    cards ${cards}`,
      `    voiced examples ${unitVoicedExamples(course, ui)}`,
      `    pool ${unit.exercises.pool.length} (choice ${byKind('choice')} / typed ${byKind('typed')} / trigger ${byKind('trigger')} / transform ${byKind('transform')})`,
      `    size ${unit.exercises.size}${unit.exercises.pool.length >= unit.exercises.size + 6 ? '' : ` ⚠ pool needs ≥ ${unit.exercises.size + 6}`}`,
    );
  });

  if (course.floorExam) {
    const fe = course.floorExam;
    const fePool = fe.pool.map((id) => byId.get(id)).filter((i): i is CourseItem => !!i);
    const choiceN = fePool.filter((i) => i.kind === 'choice').length;
    out.push(
      '',
      `  floor exam: pool ${fe.pool.length} / size ${fe.size}${fe.pool.length >= 2 * fe.size ? '' : ` ⚠ pool needs ≥ ${2 * fe.size}`} · choice ${choiceN}`,
    );
  } else {
    out.push('', `  floor exam: none (floor ${course.floor} is the orientation floor)`);
  }

  // binary-option census — non-fatal, §4.1.1 only allows 2 options on the binary set
  const choices = items.filter((i) => i.kind === 'choice');
  const twoOption = choices.filter((i) => i.kind === 'choice' && i.options.length === 2);
  const notBinary = twoOption.filter((i) => i.kind === 'choice' && !isBinaryPair(i.options));
  out.push(
    '',
    notBinary.length === 0
      ? `  binary options: ✓ ${twoOption.length} two-option item${twoOption.length === 1 ? '' : 's'}, all on the binary set`
      : `  ⚠ binary options: ${notBinary.length} two-option item${notBinary.length === 1 ? '' : 's'} not on the binary set — ${notBinary.map((i) => i.id).join(', ')}`,
  );

  const unvoiced = items.filter((i) => i.voiced === undefined);
  out.push(
    unvoiced.length === 0
      ? '  voiced: ✓ every item has a voiced sentence'
      : `  ⚠ items without voiced: ${unvoiced.length} — ${unvoiced.map((i) => i.id).join(', ')}`,
  );

  return out.join('\n');
}
