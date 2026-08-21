import { parsePack, type Pack, type Token } from '@sumrak/schema';
import { eq, sql } from 'drizzle-orm';

import { normalizeRu } from './normalize';
import {
  audioTracks,
  exerciseSpecs,
  journalPrompts,
  lessons,
  packs,
  sentences,
  stories,
  tokens,
  wordStamps,
} from './schema';
import type { PackSource } from './repositories/sync-state';
import { createSyncStateRepo } from './repositories/sync-state';
import type { SumrakDB } from './types';

export type ImportAction = 'installed' | 'updated' | 'unchanged' | 'skipped-older';

export interface ImportResult {
  packId: string;
  version: number;
  action: ImportAction;
  counts: { stories: number; sentences: number; tokens: number };
}

export interface ImportOptions {
  source?: PackSource;
  /**
   * Local audio file URIs keyed by the pack-relative path from
   * `AudioTrack.file` (e.g. "audio/story1.opus" → "file:///..."). Files are
   * expected to already sit in app-scoped storage; the importer only records
   * the URIs. Tracks without an entry keep localUri null (audio not yet
   * downloaded — fine until T10).
   */
  audioFiles?: Record<string, string>;
}

/** Effective space-before per the schema's reconstruction defaults. */
function effectiveSpaceBefore(tok: Token, index: number): boolean {
  return tok.spaceBefore ?? (index > 0 && !tok.isPunct);
}

/**
 * The pack importer (design §4.3). Validates with the T02 Zod schema (never
 * trusts input, even bundled fixtures), then denormalizes into the content
 * tables inside one transaction:
 *
 * - **new pack** → insert everything ('installed');
 * - **same version already present** → no-op ('unchanged', idempotent);
 * - **higher version** → delete the pack row (FK cascade wipes every content
 *   row for the pack) and insert the new content ('updated'). User tables
 *   are untouched: bank_items/encounters reference sentence/story ids as
 *   plain strings, and ids are stable — refs made against v1 resolve
 *   against v2's rows.
 * - **lower version than installed** → refuse ('skipped-older').
 *
 * `sync_state` (user table) records the installed version so restore/sync
 * know what should be present even after content tables are wiped.
 */
export async function importPack(
  db: SumrakDB,
  rawPack: unknown,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const pack: Pack = parsePack(rawPack);
  const source = opts.source ?? 'local-file';
  const syncStateRepo = createSyncStateRepo(db);

  const existing = await db.select().from(packs).where(eq(packs.id, pack.id)).limit(1);
  const installed = existing[0];
  const counts = countContent(pack);

  if (installed) {
    if (installed.version === pack.version) {
      // Idempotent: same version present — record sync state and leave rows alone.
      await syncStateRepo.recordInstalled(pack.id, pack.version, source);
      return { packId: pack.id, version: pack.version, action: 'unchanged', counts };
    }
    if (installed.version > pack.version) {
      return { packId: pack.id, version: installed.version, action: 'skipped-older', counts };
    }
  }

  await db.run(sql`BEGIN`);
  try {
    // Cascade-delete all previous content rows for this pack (no-op when new).
    await db.delete(packs).where(eq(packs.id, pack.id));
    await insertPackRows(db, pack, opts);
    await db.run(sql`COMMIT`);
  } catch (err) {
    await db.run(sql`ROLLBACK`);
    throw err;
  }

  await syncStateRepo.recordInstalled(pack.id, pack.version, source);
  return {
    packId: pack.id,
    version: pack.version,
    action: installed ? 'updated' : 'installed',
    counts,
  };
}

/**
 * Remove a pack: content rows cascade from the pack row; user data
 * (bank_items, encounters, cards, …) is untouched by design — its content
 * refs simply stop resolving until the pack is reinstalled.
 */
export async function removePack(db: SumrakDB, packId: string): Promise<void> {
  const syncStateRepo = createSyncStateRepo(db);
  await db.delete(packs).where(eq(packs.id, packId));
  await syncStateRepo.removeInstalled(packId);
}

function countContent(pack: Pack) {
  let sentenceCount = 0;
  let tokenCount = 0;
  for (const story of pack.stories) {
    sentenceCount += story.sentences.length;
    for (const s of story.sentences) tokenCount += s.tokens.length;
  }
  return { stories: pack.stories.length, sentences: sentenceCount, tokens: tokenCount };
}

async function insertPackRows(db: SumrakDB, pack: Pack, opts: ImportOptions): Promise<void> {
  const now = Date.now();
  await db.insert(packs).values({
    id: pack.id,
    version: pack.version,
    type: pack.type,
    titleRu: pack.title.ru,
    titleEn: pack.title.en,
    level: pack.level,
    tags: pack.tags,
    importedAt: now,
  });

  for (const [storyIdx, story] of pack.stories.entries()) {
    await db.insert(stories).values({
      packId: pack.id,
      id: story.id,
      orderIdx: storyIdx,
      titleRu: story.title.ru,
      titleEn: story.title.en,
      level: story.level,
    });

    for (const [sentenceIdx, sentence] of story.sentences.entries()) {
      await db.insert(sentences).values({
        packId: pack.id,
        id: sentence.id,
        storyId: story.id,
        orderIdx: sentenceIdx,
        ru: sentence.ru,
        en: sentence.en,
        grammarTopics: sentence.grammarTopics ?? null,
      });

      // Chunked multi-row inserts keep import fast without hitting SQLite's
      // bound-parameter limit (999): 13 columns × 64 rows = 832 params.
      const tokenRows = sentence.tokens.map((tok, tokenIndex) => ({
        packId: pack.id,
        sentenceId: sentence.id,
        tokenIndex,
        storyId: story.id,
        text: tok.text,
        textNorm: normalizeRu(tok.text),
        isPunct: tok.isPunct ?? false,
        spaceBefore: effectiveSpaceBefore(tok, tokenIndex),
        lemma: tok.lemma ?? null,
        lemmaNorm: tok.lemma ? normalizeRu(tok.lemma) : null,
        translation: tok.translation ?? null,
        pos: tok.pos ?? null,
        grammar: tok.grammar ?? null,
        level: tok.level ?? null,
        note: tok.note ?? null,
      }));
      for (let i = 0; i < tokenRows.length; i += 64) {
        await db.insert(tokens).values(tokenRows.slice(i, i + 64));
      }
    }

    for (const track of story.audio) {
      await db.insert(audioTracks).values({
        packId: pack.id,
        storyId: story.id,
        id: track.id,
        voice: track.voice,
        style: track.style,
        file: track.file,
        localUri: opts.audioFiles?.[track.file] ?? null,
        durationMs: track.durationMs,
      });

      const stampRows = track.timestamps.map((stamp, stampIndex) => ({
        packId: pack.id,
        storyId: story.id,
        trackId: track.id,
        stampIndex,
        sentenceId: stamp.sentenceId,
        tokenIndex: stamp.tokenIndex,
        startMs: stamp.startMs,
        endMs: stamp.endMs,
      }));
      for (let i = 0; i < stampRows.length; i += 100) {
        await db.insert(wordStamps).values(stampRows.slice(i, i + 100));
      }
    }
  }

  if (pack.lesson) {
    await db.insert(lessons).values({
      packId: pack.id,
      id: pack.lesson.id,
      titleRu: pack.lesson.title.ru,
      titleEn: pack.lesson.title.en,
      body: pack.lesson.body,
      grammarTopics: pack.lesson.grammarTopics ?? null,
    });
  }

  for (const prompt of pack.prompts ?? []) {
    await db.insert(journalPrompts).values({
      packId: pack.id,
      id: prompt.id,
      level: prompt.level,
      promptRu: prompt.prompt.ru,
      promptEn: prompt.prompt.en,
      tags: prompt.tags ?? null,
    });
  }

  for (const [orderIdx, spec] of (pack.exercises ?? []).entries()) {
    await db.insert(exerciseSpecs).values({
      packId: pack.id,
      id: spec.id,
      kind: spec.kind,
      orderIdx,
      spec: spec as unknown as Record<string, unknown>,
    });
  }
}
