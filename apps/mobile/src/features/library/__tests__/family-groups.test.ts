import { describe, expect, it } from 'vitest';

import {
  defaultRungLevel,
  groupByFamily,
  nextRungLevel,
  parseFamilySlug,
  rungFinished,
  sharedShelfTags,
  type FamilyMember,
  type RungState,
} from '../family-groups';

describe('parseFamilySlug', () => {
  it('extracts a well-formed family slug', () => {
    expect(parseFamilySlug(['creepypasta', 'horror', 'family:tall-dog'])).toBe('tall-dog');
    expect(parseFamilySlug(['family:x1'])).toBe('x1');
  });

  it('returns null when no family tag is present', () => {
    expect(parseFamilySlug([])).toBeNull();
    expect(parseFamilySlug(['creepypasta', 'grammar:genitive-negation'])).toBeNull();
  });

  it('treats malformed family tags as untagged (defensive parse)', () => {
    expect(parseFamilySlug(['family:'])).toBeNull();
    expect(parseFamilySlug(['family:Tall-Dog'])).toBeNull();
    expect(parseFamilySlug(['family:tall dog'])).toBeNull();
    expect(parseFamilySlug(['family:-leading'])).toBeNull();
    expect(parseFamilySlug(['family'])).toBeNull();
    expect(parseFamilySlug(['FAMILY:tall-dog'])).toBeNull();
  });

  it('takes the first well-formed tag when several appear', () => {
    expect(parseFamilySlug(['family:BAD SLUG', 'family:tall-dog', 'family:other'])).toBe(
      'tall-dog',
    );
  });
});

interface Item {
  member: FamilyMember;
}

const item = (packId: string, level: FamilyMember['level'], tags: string[]): Item => ({
  member: { packId, level, tags },
});
const getMember = (i: Item) => i.member;
const familyTags = ['creepypasta', 'horror', 'family:tall-dog'];

describe('groupByFamily', () => {
  const a1 = item('a1-tall-dog-001', 'A1', familyTags);
  const a2 = item('a2-tall-dog-001', 'A2', familyTags);
  const b1 = item('b1-tall-dog-001', 'B1', familyTags);
  const unit = item('a1-course-unit-001', 'A1', ['course']);
  const family2 = item('a2-family-001', 'A2', ['family']); // bare word, not a family: tag

  it('collapses ≥2 packs sharing a slug into one shelf at the first member position', () => {
    const result = groupByFamily([unit, a1, family2, a2, b1], getMember);
    expect(result.map((r) => r.kind)).toEqual(['single', 'family', 'single']);
    const shelf = result[1];
    if (shelf?.kind !== 'family') throw new Error('expected family');
    expect(shelf.slug).toBe('tall-dog');
    expect(shelf.members.map((m) => m.member.packId)).toEqual([
      'a1-tall-dog-001',
      'a2-tall-dog-001',
      'b1-tall-dog-001',
    ]);
  });

  it('a newly installed higher rung joins the existing shelf position (CT002b fix)', () => {
    const before = groupByFamily([a1, unit, a2], getMember);
    const after = groupByFamily([a1, unit, a2, b1], getMember); // b1 appended by install order
    expect(before.findIndex((r) => r.kind === 'family')).toBe(0);
    expect(after.findIndex((r) => r.kind === 'family')).toBe(0);
    const shelf = after[0];
    if (shelf?.kind !== 'family') throw new Error('expected family');
    expect(shelf.members.map((m) => m.member.level)).toEqual(['A1', 'A2', 'B1']);
  });

  it('sorts members in CEFR order even when install order differs', () => {
    const result = groupByFamily([b1, a2, a1], getMember);
    const shelf = result[0];
    if (shelf?.kind !== 'family') throw new Error('expected family');
    expect(shelf.members.map((m) => m.member.level)).toEqual(['A1', 'A2', 'B1']);
  });

  it('a single-member family renders as a plain section (no premature shelf)', () => {
    const result = groupByFamily([unit, a1], getMember);
    expect(result.every((r) => r.kind === 'single')).toBe(true);
  });

  it('non-family packs pass through untouched, same objects, same order', () => {
    const items = [unit, family2];
    const result = groupByFamily(items, getMember);
    expect(result).toEqual([
      { kind: 'single', item: unit },
      { kind: 'single', item: family2 },
    ]);
    const head = result[0];
    if (head?.kind === 'single') expect(head.item).toBe(unit);
  });

  it('groups independent families independently', () => {
    const catA = item('a1-cat-001', 'A1', ['family:cat']);
    const catB = item('a2-cat-001', 'A2', ['family:cat']);
    const result = groupByFamily([a1, catA, a2, catB], getMember);
    expect(result.map((r) => (r.kind === 'family' ? r.slug : 'single'))).toEqual([
      'tall-dog',
      'cat',
    ]);
  });
});

const rung = (
  level: RungState['level'],
  finishedCount: number,
  storyCount: number,
  lastReadAt: number | null = null,
): RungState => ({ level, storyCount, finishedCount, lastReadAt });

describe('defaultRungLevel', () => {
  it('prefers the most-recently-read rung', () => {
    expect(
      defaultRungLevel([rung('A1', 7, 7, 100), rung('A2', 1, 7, 900), rung('B1', 0, 7, 500)]),
    ).toBe('A2');
  });

  it('ties on recency go to the lower level', () => {
    expect(defaultRungLevel([rung('A1', 0, 7, 500), rung('A2', 0, 7, 500)])).toBe('A1');
  });

  it('falls back to the lowest rung with unfinished stories when nothing was read', () => {
    expect(defaultRungLevel([rung('A1', 7, 7), rung('A2', 7, 7), rung('B1', 0, 7)])).toBe('B1');
  });

  it('falls back to the lowest rung when everything is finished', () => {
    expect(defaultRungLevel([rung('A1', 7, 7), rung('A2', 7, 7)])).toBe('A1');
  });

  it('a partially-read-but-never-touched mix: reading anywhere wins over unfinished-lowest', () => {
    expect(defaultRungLevel([rung('A1', 0, 7), rung('B1', 2, 7, 50)])).toBe('B1');
  });
});

describe('nextRungLevel', () => {
  it('offers the next installed higher rung when the selection is fully finished', () => {
    expect(nextRungLevel([rung('A1', 7, 7), rung('A2', 0, 7)], 'A1')).toBe('A2');
  });

  it('skips gaps to the lowest installed higher rung', () => {
    expect(nextRungLevel([rung('A1', 7, 7), rung('B1', 0, 7)], 'A1')).toBe('B1');
  });

  it('returns null while the selected rung is unfinished', () => {
    expect(nextRungLevel([rung('A1', 6, 7), rung('A2', 0, 7)], 'A1')).toBeNull();
  });

  it('returns null on the highest installed rung even when finished', () => {
    expect(nextRungLevel([rung('A1', 7, 7), rung('A2', 7, 7)], 'A2')).toBeNull();
  });

  it('an empty rung never counts as finished', () => {
    expect(rungFinished(rung('A1', 0, 0))).toBe(false);
    expect(nextRungLevel([rung('A1', 0, 0), rung('A2', 0, 7)], 'A1')).toBeNull();
  });
});

describe('sharedShelfTags', () => {
  it('keeps tags shared by all rungs, drops family:* and grammar:*', () => {
    expect(
      sharedShelfTags([
        ['creepypasta', 'horror', 'family:tall-dog', 'grammar:prepositional-location'],
        ['creepypasta', 'horror', 'family:tall-dog', 'grammar:genitive-negation'],
      ]),
    ).toEqual(['creepypasta', 'horror']);
  });

  it('drops tags not present on every rung', () => {
    expect(sharedShelfTags([['creepypasta', 'bonus'], ['creepypasta']])).toEqual(['creepypasta']);
  });

  it('handles the empty case', () => {
    expect(sharedShelfTags([])).toEqual([]);
  });
});
