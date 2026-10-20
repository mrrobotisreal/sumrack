import type { PilotSkill } from './catalog';

/** A topic is not a skill. These reviewed item aliases bind the inspected v1 packs.
 * Case-acc also contains objects/time, case-dat age/direction, agr pronouns/plurals.
 * Unknown versions, arbitrary topic strings, and unreviewed items stay unmapped.
 */
const aliases = new Map<string, PilotSkill>();
const add = (pack: string, topic: string, ids: string[], skill: PilotSkill) => {
  for (const id of ids) aliases.set(`${pack}:1:${topic}:${id}`, skill);
};
add(
  'a1-hotel-f03',
  'case-prep',
  ['u1-k01', 'u1-k02', 'u1-k03', 'u1-k04', 'u1-c01'],
  'location-destination',
);
add('a1-hotel-f07', 'case-dat', ['u1-c01', 'u1-c02', 'u1-c03', 'u1-c04', 'u1-c05'], 'dative-verbs');
add(
  'a1-hotel-f01',
  'agr',
  [
    'u5-k01',
    'u5-k02',
    'u5-k03',
    'u5-k04',
    'u5-k05',
    'u5-k07',
    'u5-c01',
    'u5-c02',
    'u5-c03',
    'u5-c04',
    'u5-t01',
    'u5-t02',
    'u5-t03',
    'u5-t05',
  ],
  'adjective-agreement',
);
add(
  'a1-torfl-lexgram-001',
  'case-prep',
  [
    'lg-case-prep-01',
    'lg-case-prep-02',
    'lg-case-prep-03',
    'lg-case-prep-04',
    'lg-case-prep-05',
    'lg-case-prep-12',
    'lg-case-prep-13',
    'lg-case-prep-14',
    'lg-case-prep-15',
    'lg-case-prep-16',
  ],
  'location-destination',
);
add(
  'a1-torfl-lexgram-001',
  'case-acc',
  ['lg-case-acc-01', 'lg-case-acc-02', 'lg-case-acc-03', 'lg-case-acc-04', 'lg-case-acc-05'],
  'location-destination',
);
add(
  'a1-torfl-lexgram-001',
  'case-dat',
  [
    'lg-case-dat-01',
    'lg-case-dat-02',
    'lg-case-dat-03',
    'lg-case-dat-04',
    'lg-case-dat-05',
    'lg-case-dat-06',
    'lg-case-dat-07',
    'lg-case-dat-08',
    'lg-case-dat-09',
  ],
  'dative-verbs',
);
add(
  'a1-torfl-lexgram-001',
  'agr',
  ['lg-agr-11', 'lg-agr-12', 'lg-agr-13', 'lg-agr-14', 'lg-agr-15', 'lg-agr-16', 'lg-agr-17'],
  'adjective-agreement',
);

export function isHeldOut(packId: string, sourceId = ''): boolean {
  return /(?:mock[-_]?004|room[-_]?13|hotel[-_]?f13)/i.test(`${packId}/${sourceId}`);
}
export function resolveSkill(
  packId: string,
  currentVersion: number | null,
  topic: string,
  itemId: string,
): PilotSkill | null {
  if (isHeldOut(packId, itemId)) return null;
  return aliases.get(`${packId}:${currentVersion}:${topic}:${itemId}`) ?? null;
}
