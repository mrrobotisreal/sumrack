import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nounProfile, verbProfile } from '@/features/word-forms/__tests__/fixtures';

import { createBankRepo } from '../repositories/bank';
import { createWordFormsRepo, type NewWordProfile } from '../repositories/word-forms';
import { bankItems } from '../schema';
import { createTestDb } from './helpers';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track }));

const RECEIPT = {
  provider: 'anthropic' as const,
  model: 'anthropic/claude-opus-5.5',
  quality: 'normal' as const,
  effort: 'high' as const,
  effortApplied: true,
  promptTokens: 1000,
  completionTokens: 3000,
  reasoningTokens: 500,
  costUsd: 0.04,
  durationMs: 30_000,
};

function verbRow(overrides: Partial<NewWordProfile> = {}): NewWordProfile {
  return {
    lemmaNorm: 'говорить',
    kind: 'word',
    headword: 'говорить',
    pos: 'verb',
    payload: verbProfile() as unknown as Record<string, unknown>,
    ...RECEIPT,
    ...overrides,
  };
}

beforeEach(() => track.mockClear());

describe('word-forms repo — profiles (§5.4)', () => {
  it('insertProfile makes the new row current and demotes the previous one; versions list newest first', async () => {
    const repo = createWordFormsRepo(createTestDb());
    const v1 = await repo.insertProfile(verbRow({ createdAt: 1000 }));
    expect(v1.isCurrent).toBe(true);
    const v2 = await repo.insertProfile(verbRow({ createdAt: 2000, model: 'openai/gpt-6-sol' }));
    const v3 = await repo.insertProfile(verbRow({ createdAt: 3000 }));

    const versions = await repo.listProfileVersions('говорить', 'word');
    expect(versions.map((v) => v.id)).toEqual([v3.id, v2.id, v1.id]);
    expect(versions.map((v) => v.isCurrent)).toEqual([true, false, false]);
    for (const v of versions) expect(v.profile?.headword.plain).toBe('говорить');

    const current = await repo.getCurrentProfile('говорить', 'word');
    expect(current?.id).toBe(v3.id);
    expect(current?.profile?.pos).toBe('verb');
    expect(await repo.countProfiles()).toEqual({ total: 3, current: 1, keys: 1 });
    // A different key is independent (same lemma text, other kind).
    await repo.insertProfile(verbRow({ kind: 'phrase', pos: 'phrase' }));
    expect((await repo.getCurrentProfile('говорить', 'word'))?.id).toBe(v3.id);
    expect(await repo.countProfiles()).toEqual({ total: 4, current: 2, keys: 2 });
  });

  it('promoteProfile swaps current in one step; unknown id → false; already current → true', async () => {
    const repo = createWordFormsRepo(createTestDb());
    const v1 = await repo.insertProfile(verbRow({ createdAt: 1000 }));
    const v2 = await repo.insertProfile(verbRow({ createdAt: 2000 }));
    expect(await repo.promoteProfile(v1.id)).toBe(true);
    expect((await repo.getCurrentProfile('говорить', 'word'))?.id).toBe(v1.id);
    expect((await repo.getProfileById(v2.id))?.isCurrent).toBe(false);
    expect(await repo.promoteProfile(v1.id)).toBe(true);
    expect(await repo.promoteProfile('nope')).toBe(false);
    // Still exactly one current (the partial index would have thrown otherwise).
    expect(await repo.countProfiles()).toMatchObject({ current: 1 });
  });

  it('an unreadable payload reads as absent: getCurrentProfile → null, one app_error per row, no crash', async () => {
    const db = createTestDb();
    const repo = createWordFormsRepo(db);
    const bad = await repo.insertProfile(
      verbRow({ payload: { v: 2, future: 'shape' }, createdAt: 1000 }),
    );
    expect(await repo.getCurrentProfile('говорить', 'word')).toBeNull();
    const versions = await repo.listProfileVersions('говорить', 'word');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ id: bad.id, profile: null, isCurrent: true });
    await repo.getCurrentProfile('говорить', 'word');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('app_error', { scope: 'word-profile-parse', fatal: false });
    // Garbage that is not even JSON-shaped is equally harmless.
    await db.run(sql`UPDATE word_profiles SET payload = '"just a string"' WHERE id = ${bad.id}`);
    expect(await repo.getCurrentProfile('говорить', 'word')).toBeNull();
  });

  it('listRecentProfiles is newest first across keys', async () => {
    const repo = createWordFormsRepo(createTestDb());
    await repo.insertProfile(verbRow({ createdAt: 1 }));
    await repo.insertProfile(
      verbRow({
        lemmaNorm: 'окно',
        headword: 'окно',
        pos: 'noun',
        payload: nounProfile(),
        createdAt: 2,
      }),
    );
    const recent = await repo.listRecentProfiles(5);
    expect(recent.map((r) => r.headword)).toEqual(['окно', 'говорить']);
    expect(await repo.listRecentProfiles(1)).toHaveLength(1);
  });
});

describe('word-forms repo — items without a profile (§5.4)', () => {
  it('words via lemma_norm, phrases via normalized, lemma-less words excluded, met-order', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const repo = createWordFormsRepo(db);
    const word = await bank.addWord({ lemma: 'Говорить', surface: 'говорю', translation: 'speak' });
    const phrase = await bank.addPhrase({
      surface: 'Волосы  встали дыбом',
      translation: 'hair stood',
    });
    const other = await bank.addWord({ lemma: 'окно', surface: 'окно', translation: 'window' });
    // Pin distinct created_at values: three inserts can land in the same
    // millisecond, and the id tiebreak is random-suffixed (T54 saw it flake).
    const t0 = Date.now() - 1000;
    for (const [i, id] of [word.item.id, phrase.item.id, other.item.id].entries()) {
      await db
        .update(bankItems)
        .set({ createdAt: t0 + i })
        .where(eq(bankItems.id, id));
    }
    // A needs-enrichment word with no lemma yet (the popup's capture path writes these).
    await db.insert(bankItems).values({
      id: 'bi-nolemma',
      kind: 'word',
      lemma: null,
      lemmaNorm: null,
      surface: 'чего-то',
      normalized: 'чего-то',
      translation: '',
      needsEnrichment: true,
      createdAt: Date.now() + 10,
    });

    expect(await repo.countItemsWithoutProfile()).toBe(3);
    expect((await repo.listItemsWithoutProfile(10)).map((i) => i.id)).toEqual([
      word.item.id,
      phrase.item.id,
      other.item.id,
    ]);

    // A current profile under the WORD key removes the word…
    await repo.insertProfile(verbRow({ lemmaNorm: word.item.lemmaNorm! }));
    expect((await repo.listItemsWithoutProfile(10)).map((i) => i.id)).toEqual([
      phrase.item.id,
      other.item.id,
    ]);
    // …a profile under the PHRASE key (normalized text) removes the phrase…
    await repo.insertProfile(
      verbRow({ lemmaNorm: phrase.item.normalized, kind: 'phrase', pos: 'phrase' }),
    );
    expect((await repo.listItemsWithoutProfile(10)).map((i) => i.id)).toEqual([other.item.id]);
    expect(await repo.countItemsWithoutProfile()).toBe(1);
    // …and a NON-current version does not count as coverage.
    await db.run(sql`UPDATE word_profiles SET is_current = 0`);
    expect(await repo.countItemsWithoutProfile()).toBe(3);
    expect(await repo.listItemsWithoutProfile(1)).toHaveLength(1);
  });
});

describe('word-forms repo — lessons (§5.4, append-only)', () => {
  const lesson = (
    over: Partial<Parameters<ReturnType<typeof createWordFormsRepo>['insertLesson']>[0]> = {},
  ) => ({
    lemmaNorm: 'говорить',
    kind: 'word' as const,
    headword: 'говорить',
    sectionId: 'verb-nonpast',
    profileId: null,
    markdown: '## lesson',
    ...RECEIPT,
    ...over,
  });

  it('insert / get / per-section list (newest first) / counts grouped by section', async () => {
    const repo = createWordFormsRepo(createTestDb());
    const a = await repo.insertLesson(lesson({ createdAt: 1 }));
    const b = await repo.insertLesson(lesson({ createdAt: 2 }));
    const c = await repo.insertLesson(lesson({ sectionId: 'verb-past', createdAt: 3 }));
    await repo.insertLesson(
      lesson({ lemmaNorm: 'окно', headword: 'окно', sectionId: 'noun-declension', createdAt: 4 }),
    );

    expect((await repo.getLesson(a.id))?.markdown).toBe('## lesson');
    expect(await repo.getLesson('nope')).toBeNull();
    expect(
      (await repo.listLessonsForSection('говорить', 'word', 'verb-nonpast')).map((l) => l.id),
    ).toEqual([b.id, a.id]);
    expect(await repo.countLessonsForKey('говорить', 'word')).toEqual({
      'verb-nonpast': 2,
      'verb-past': 1,
    });
    expect(await repo.countLessonsForKey('окно', 'word')).toEqual({ 'noun-declension': 1 });
    expect(await repo.countLessonsForKey('нет', 'word')).toEqual({});
    expect(await repo.countLessons()).toBe(4);
    expect(c.sectionId).toBe('verb-past');
    // T54: every lesson of one key, newest first across sections
    expect((await repo.listLessonsForKey('говорить', 'word')).map((l) => l.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
    expect(await repo.listLessonsForKey('нет', 'word')).toEqual([]);
  });

  it('listLessons: global newest first, paginated, ё/е-tolerant search on the headword', async () => {
    const repo = createWordFormsRepo(createTestDb());
    await repo.insertLesson(lesson({ createdAt: 1 }));
    await repo.insertLesson(
      lesson({ lemmaNorm: 'еж', headword: 'ёж', sectionId: 'noun-declension', createdAt: 2 }),
    );
    await repo.insertLesson(
      lesson({ lemmaNorm: 'окно', headword: 'окно', sectionId: 'noun-declension', createdAt: 3 }),
    );
    await repo.insertLesson(
      lesson({ lemmaNorm: 'петр', headword: 'Пётр', sectionId: 'name-declension', createdAt: 4 }),
    );

    const all = await repo.listLessons({ limit: 10, offset: 0 });
    expect(all.map((l) => l.headword)).toEqual(['Пётр', 'окно', 'ёж', 'говорить']);
    expect((await repo.listLessons({ limit: 2, offset: 1 })).map((l) => l.headword)).toEqual([
      'окно',
      'ёж',
    ]);
    // е finds ё and ё finds ё; capitalized headwords match too.
    expect(
      (await repo.listLessons({ search: 'еж', limit: 10, offset: 0 })).map((l) => l.headword),
    ).toEqual(['ёж']);
    expect(
      (await repo.listLessons({ search: 'ёж', limit: 10, offset: 0 })).map((l) => l.headword),
    ).toEqual(['ёж']);
    expect(
      (await repo.listLessons({ search: 'пётр', limit: 10, offset: 0 })).map((l) => l.headword),
    ).toEqual(['Пётр']);
    expect(
      (await repo.listLessons({ search: 'ГОВОР', limit: 10, offset: 0 })).map((l) => l.headword),
    ).toEqual(['говорить']);
    expect(await repo.listLessons({ search: 'zzz', limit: 10, offset: 0 })).toEqual([]);
    expect(await repo.listLessons({ search: '   ', limit: 10, offset: 0 })).toHaveLength(4);
  });
});
