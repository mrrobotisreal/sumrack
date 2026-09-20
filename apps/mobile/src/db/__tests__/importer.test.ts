import type { Pack } from '@sumrak/schema';
import { SchemaValidationError } from '@sumrak/schema';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import comedyJson from '@sumrak/schema/fixtures/packs/a1-comedy-090/pack.json';
import hallwayJson from '@sumrak/schema/fixtures/packs/a1-course-unit-090/pack.json';
import greenhouseJson from '@sumrak/schema/fixtures/packs/a1-course-unit-093/pack.json';
import pack1Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import pack2Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-002/pack.json';
import familyJson from '@sumrak/schema/fixtures/packs/a2-family-090/pack.json';
import newsJson from '@sumrak/schema/fixtures/packs/a2-news-090/pack.json';

import { importPack, removePack } from '../importer';
import { createBankRepo } from '../repositories/bank';
import { createContentRepo } from '../repositories/content';
import { createSyncStateRepo } from '../repositories/sync-state';
import { createTestDb } from './helpers';

const pack1 = pack1Json as unknown as Pack;
const pack2 = pack2Json as unknown as Pack;
const hallwayPack = hallwayJson as unknown as Pack;
const greenhousePack = greenhouseJson as unknown as Pack;
const familyPack = familyJson as unknown as Pack;
const newsPack = newsJson as unknown as Pack;
const comedyPack = comedyJson as unknown as Pack;

/** The M14 story columns, selected raw so the test pins the SQL names too. */
const M14_STORY_SQL = sql`SELECT id, subtitle_ru, subtitle_en, source_name, source_url,
  source_published_at, source_author FROM stories WHERE pack_id = `;
interface M14StoryRow {
  id: string;
  subtitle_ru: string | null;
  subtitle_en: string | null;
  source_name: string | null;
  source_url: string | null;
  source_published_at: string | null;
  source_author: string | null;
}
const NULL_STORY_COLUMNS = {
  subtitle_ru: null,
  subtitle_en: null,
  source_name: null,
  source_url: null,
  source_published_at: null,
  source_author: null,
};

/** v2 of pack 1: last sentence dropped, first translation reworded — real content churn. */
function pack1v2(): Pack {
  const clone: Pack = JSON.parse(JSON.stringify(pack1));
  clone.version = 2;
  const story = clone.stories[0]!;
  story.sentences = story.sentences.slice(0, -1);
  story.sentences[0]!.en = 'I live alone in an old apartment. (v2)';
  // Drop audio: its stamps reference the removed sentence in the fixture-agnostic worst case.
  story.audio = story.audio.filter((t) =>
    t.timestamps.every((s) => story.sentences.some((sen) => sen.id === s.sentenceId)),
  );
  return clone;
}

describe('pack importer', () => {
  it('imports both T02 fixture packs and denormalizes all rows', async () => {
    const db = createTestDb();
    const content = createContentRepo(db);

    const r1 = await importPack(db, pack1, { source: 'bundled' });
    const r2 = await importPack(db, pack2, { source: 'bundled' });
    expect(r1.action).toBe('installed');
    expect(r2.action).toBe('installed');

    const packs = await content.listPacks();
    expect(packs.map((p) => p.id).sort()).toEqual(['a1-creepypasta-001', 'a1-creepypasta-002']);
    // Regression: correlated count subqueries must be qualified (were 0).
    expect(packs.map((p) => p.storyCount)).toEqual([1, 1]);
    const storyList = await content.listStories();
    expect(storyList).toHaveLength(2);
    expect(storyList.map((s) => s.sentenceCount)).toEqual([11, 11]);

    const detail = await content.getStoryDetail('a1-creepypasta-001', 'knock-in-the-wall');
    expect(detail).not.toBeNull();
    expect(detail!.sentences).toHaveLength(11);
    expect(detail!.sentences[0]!.tokens.length).toBeGreaterThan(0);
    expect(detail!.audio).toHaveLength(1);

    const stamps = await content.getWordStamps(
      'a1-creepypasta-001',
      'knock-in-the-wall',
      detail!.audio[0]!.id,
    );
    expect(stamps).toHaveLength(59);
  });

  it('THE invariant: version bump replaces content rows but preserves user refs', async () => {
    const db = createTestDb();
    const content = createContentRepo(db);
    const bank = createBankRepo(db);

    await importPack(db, pack1, { source: 'bundled' });

    // User highlights «стене» in sentence knock-s02 → bank item referencing v1 content.
    const added = await bank.addWord({
      lemma: 'стена',
      surface: 'стене',
      translation: 'wall',
      pos: 'noun',
      level: 'A1',
      sentenceId: 'knock-s02',
      sourceStoryId: 'knock-in-the-wall',
    });
    expect(added.created).toBe(true);

    const v1Sentences = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM sentences WHERE pack_id = 'a1-creepypasta-001'`,
    );

    // Reimport at version 2 with different content.
    const result = await importPack(db, pack1v2(), { source: 'bundled' });
    expect(result.action).toBe('updated');

    // Content rows were replaced: one fewer sentence, reworded translation.
    const v2Sentences = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM sentences WHERE pack_id = 'a1-creepypasta-001'`,
    );
    expect(v2Sentences[0]!.n).toBe(v1Sentences[0]!.n - 1);
    const detail = await content.getStoryDetail('a1-creepypasta-001', 'knock-in-the-wall');
    expect(detail!.sentences[0]!.en).toContain('(v2)');

    // The bank item survived untouched and its sentence ref still resolves.
    const item = await bank.getItemWithEncounters(added.item.id);
    expect(item).not.toBeNull();
    expect(item!.sourceSentenceId).toBe('knock-s02');
    expect(item!.encounters).toHaveLength(1);
    const resolved = await content.resolveSentence('knock-s02');
    expect(resolved).not.toBeNull();
    expect(resolved!.sentence.ru).toBe('Ночью я слышу стук в стене.');
    expect(resolved!.story!.id).toBe('knock-in-the-wall');
  });

  it('is idempotent: reimporting the same version is a no-op', async () => {
    const db = createTestDb();
    await importPack(db, pack1, { source: 'bundled' });
    const before = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM tokens`);
    const again = await importPack(db, pack1, { source: 'bundled' });
    expect(again.action).toBe('unchanged');
    const after = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM tokens`);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('refuses to downgrade to an older version', async () => {
    const db = createTestDb();
    await importPack(db, pack1v2(), { source: 'bundled' });
    const result = await importPack(db, pack1, { source: 'bundled' });
    expect(result.action).toBe('skipped-older');
    expect(result.version).toBe(2);
  });

  it('removal deletes all content rows (cascade) but leaves user data intact', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    const syncStateRepo = createSyncStateRepo(db);

    await importPack(db, pack1, { source: 'bundled' });
    const added = await bank.addWord({
      lemma: 'стук',
      surface: 'стук',
      translation: 'knock',
      sentenceId: 'knock-s02',
    });

    await removePack(db, 'a1-creepypasta-001');

    for (const table of [
      'packs',
      'stories',
      'sentences',
      'tokens',
      'audio_tracks',
      'word_stamps',
    ]) {
      const rows = await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`));
      expect(rows[0]!.n, `${table} should be empty`).toBe(0);
    }
    expect(await syncStateRepo.getInstalled('a1-creepypasta-001')).toBeNull();

    // User data untouched (ref simply doesn't resolve until reinstall).
    const item = await bank.getItem(added.item.id);
    expect(item).not.toBeNull();
    expect(item!.sourceSentenceId).toBe('knock-s02');
  });

  it('records installed versions in sync_state (user table)', async () => {
    const db = createTestDb();
    const syncStateRepo = createSyncStateRepo(db);
    await importPack(db, pack1, { source: 'bundled' });
    await importPack(db, pack1v2(), { source: 'bundled' });
    const installed = await syncStateRepo.getInstalled('a1-creepypasta-001');
    expect(installed).toMatchObject({ version: 2, source: 'bundled' });
  });

  it('T30: maps theme/track into pack columns; packs without them stay NULL', async () => {
    const db = createTestDb();
    await importPack(db, hallwayPack, { source: 'bundled' });
    await importPack(db, familyPack, { source: 'bundled' });
    await importPack(db, pack1, { source: 'bundled' });

    const rows = await db.all<{
      id: string;
      theme_scene: string | null;
      theme_accent: string | null;
      track: string | null;
    }>(sql`SELECT id, theme_scene, theme_accent, track FROM packs ORDER BY id`);
    expect(rows).toEqual([
      { id: 'a1-course-unit-090', theme_scene: 'hallway', theme_accent: null, track: null },
      { id: 'a1-creepypasta-001', theme_scene: null, theme_accent: null, track: null },
      { id: 'a2-family-090', theme_scene: null, theme_accent: null, track: 'family' },
    ]);
  });

  it('T30: an unknown scene imports cleanly (forward compatibility)', async () => {
    const db = createTestDb();
    const result = await importPack(db, greenhousePack, { source: 'bundled' });
    expect(result.action).toBe('installed');
    const rows = await db.all<{ theme_scene: string; theme_accent: string | null }>(
      sql`SELECT theme_scene, theme_accent FROM packs WHERE id = 'a1-course-unit-093'`,
    );
    expect(rows[0]).toEqual({ theme_scene: 'greenhouse', theme_accent: null });
  });

  it('T44: news fixture round-trips category + every story subtitle/source column', async () => {
    const db = createTestDb();
    const content = createContentRepo(db);
    expect((await importPack(db, newsPack, { source: 'bundled' })).action).toBe('installed');

    const packRows = await db.all<{ category: string | null; genre: string | null }>(
      sql`SELECT category, genre FROM packs WHERE id = 'a2-news-090'`,
    );
    expect(packRows[0]).toEqual({ category: 'news', genre: null });

    const rows = await db.all<M14StoryRow>(sql`${M14_STORY_SQL}'a2-news-090' ORDER BY order_idx`);
    expect(rows).toEqual([
      {
        id: 'news-090-a1',
        subtitle_ru: 'Мост через реку Зальцах строили два года',
        subtitle_en: 'The bridge over the Salzach took two years to build',
        source_name: 'Сумрак-тест',
        source_url: null, // #1 has no url
        source_published_at: '2026-09-10',
        source_author: 'Редакция',
      },
      {
        id: 'news-090-a2',
        subtitle_ru: 'Ночью температура упала ниже нуля',
        subtitle_en: 'Overnight the temperature fell below zero',
        source_name: 'Сумрак-тест',
        source_url: 'https://example.invalid/first-snow',
        source_published_at: '2026-09-14',
        source_author: null, // #2 has no byline
      },
    ]);

    // The typed read path exposes them without column enumeration:
    // listStories() spreads the full stories row, getStoryDetail() too.
    const list = await content.listStories();
    const second = list.find((s) => s.id === 'news-090-a2')!;
    expect(second.sourceUrl).toBe('https://example.invalid/first-snow');
    expect(second.sourcePublishedAt).toBe('2026-09-14');
    expect(second.subtitleRu).toBe('Ночью температура упала ниже нуля');
    const detail = await content.getStoryDetail('a2-news-090', 'news-090-a1');
    expect(detail!.pack.category).toBe('news');
    expect(detail!.story.sourceAuthor).toBe('Редакция');
  });

  it('T44: comedy fixture maps genre; its story has no source/subtitle', async () => {
    const db = createTestDb();
    await importPack(db, comedyPack, { source: 'bundled' });
    const packRows = await db.all<{ category: string | null; genre: string | null }>(
      sql`SELECT category, genre FROM packs WHERE id = 'a1-comedy-090'`,
    );
    expect(packRows[0]).toEqual({ category: 'stories', genre: 'comedy' });
    const rows = await db.all<M14StoryRow>(sql`${M14_STORY_SQL}'a1-comedy-090'`);
    expect(rows).toEqual([{ id: 'com-090-s1', ...NULL_STORY_COLUMNS }]);
  });

  it('T44: a legacy pack (no M14 fields) leaves all eight columns NULL', async () => {
    const db = createTestDb();
    await importPack(db, pack1, { source: 'bundled' });
    const packRows = await db.all<{ category: string | null; genre: string | null }>(
      sql`SELECT category, genre FROM packs WHERE id = 'a1-creepypasta-001'`,
    );
    expect(packRows[0]).toEqual({ category: null, genre: null });
    const rows = await db.all<M14StoryRow>(sql`${M14_STORY_SQL}'a1-creepypasta-001'`);
    expect(rows).toEqual([{ id: 'knock-in-the-wall', ...NULL_STORY_COLUMNS }]);
  });

  it('T44: a version-bump re-import rewrites the M14 columns (update path)', async () => {
    const db = createTestDb();
    await importPack(db, newsPack, { source: 'bundled' });

    const v2: Pack = JSON.parse(JSON.stringify(newsPack));
    v2.version = 2;
    v2.genre = 'absurd'; // ignored by the app for non-stories, but stored verbatim
    const first = v2.stories[0]!;
    first.subtitle = { ru: 'Новый подзаголовок', en: 'New subtitle' };
    first.source = { name: 'Медуза', url: 'https://example.invalid/v2', publishedAt: '2026-09-20' };
    delete v2.stories[1]!.source;
    delete v2.stories[1]!.subtitle;

    expect((await importPack(db, v2, { source: 'bundled' })).action).toBe('updated');

    const packRows = await db.all<{ category: string | null; genre: string | null }>(
      sql`SELECT category, genre FROM packs WHERE id = 'a2-news-090'`,
    );
    expect(packRows[0]).toEqual({ category: 'news', genre: 'absurd' });
    const rows = await db.all<M14StoryRow>(sql`${M14_STORY_SQL}'a2-news-090' ORDER BY order_idx`);
    expect(rows).toEqual([
      {
        id: 'news-090-a1',
        subtitle_ru: 'Новый подзаголовок',
        subtitle_en: 'New subtitle',
        source_name: 'Медуза',
        source_url: 'https://example.invalid/v2',
        source_published_at: '2026-09-20',
        source_author: null, // v2 dropped the byline — must not linger from v1
      },
      { id: 'news-090-a2', ...NULL_STORY_COLUMNS },
    ]);
  });

  it('rejects invalid packs with precise schema errors before touching the DB', async () => {
    const db = createTestDb();
    const broken = JSON.parse(JSON.stringify(pack1));
    broken.stories[0].sentences[0].tokens[0].text = 'НЕ ТОТ ТЕКСТ';
    await expect(importPack(db, broken)).rejects.toBeInstanceOf(SchemaValidationError);
    const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM packs`);
    expect(rows[0]!.n).toBe(0);
  });
});
