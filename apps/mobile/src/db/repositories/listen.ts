import { asc, eq, inArray, sql } from 'drizzle-orm';

import { audioTracks, packFullAudio, packs, stories } from '../schema';
import type { SumrakDB } from '../types';

/**
 * Listen-to-the-whole-story source (T95, FULL_STORY_LISTEN §4.2).
 * `full` = the pipeline-stitched track of a multi-part pack; `single` = the
 * one narration of a one-story pack (segments = that one track from 0).
 */
export interface ListenSegment {
  storyId: string;
  trackId: string;
  titleRu: string;
  orderIdx: number;
  startMs: number;
  endMs: number;
}

export interface ListenSource {
  kind: 'full' | 'single';
  packId: string;
  titleRu: string;
  titleEn: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  voice: string;
  /** Staged file uri; null while the (deferred) download is pending. */
  uri: string | null;
  durationMs: number;
  coverUri: string | null;
  segments: ListenSegment[];
}

export interface ListenAvailability {
  state: 'ready' | 'pending' | 'none';
  parts: number;
  durationMs: number;
  voice: string;
}

const NONE: ListenAvailability = { state: 'none', parts: 0, durationMs: 0, voice: '' };

export function createListenRepo(db: SumrakDB) {
  /** Pack ids (of `stories` packs) with exactly one story having >= 1 track. */
  async function singleStoryPackIds(packIds: string[]): Promise<Set<string>> {
    if (packIds.length === 0) return new Set();
    const rows = await db
      .select({ packId: stories.packId })
      .from(stories)
      .innerJoin(packs, eq(packs.id, stories.packId))
      .where(inArray(stories.packId, packIds))
      .groupBy(stories.packId)
      .having(sql`count(*) = 1 and ${packs.type} = 'stories'`);
    if (rows.length === 0) return new Set();
    const withTrack = await db
      .select({ packId: audioTracks.packId })
      .from(audioTracks)
      .where(
        inArray(
          audioTracks.packId,
          rows.map((r) => r.packId),
        ),
      )
      .groupBy(audioTracks.packId);
    return new Set(withTrack.map((r) => r.packId));
  }

  return {
    async getListenSource(packId: string): Promise<ListenSource | null> {
      const pack = (await db.select().from(packs).where(eq(packs.id, packId)).limit(1))[0];
      if (!pack || pack.type !== 'stories') return null;
      const base = {
        packId,
        titleRu: pack.titleRu,
        titleEn: pack.titleEn,
        level: pack.level,
        coverUri: pack.coverLocalUri,
      };

      const full = (
        await db.select().from(packFullAudio).where(eq(packFullAudio.packId, packId)).limit(1)
      )[0];
      if (full) {
        const storyRows = await db
          .select({ id: stories.id, titleRu: stories.titleRu, orderIdx: stories.orderIdx })
          .from(stories)
          .where(eq(stories.packId, packId));
        const byId = new Map(storyRows.map((s) => [s.id, s]));
        const segments: ListenSegment[] = full.segments
          .map((seg) => {
            const st = byId.get(seg.storyId);
            return {
              storyId: seg.storyId,
              trackId: seg.trackId,
              titleRu: st?.titleRu ?? '',
              orderIdx: st?.orderIdx ?? 0,
              startMs: seg.startMs,
              endMs: seg.endMs,
            };
          })
          .sort((a, b) => a.orderIdx - b.orderIdx);
        return {
          kind: 'full',
          ...base,
          voice: full.voice,
          uri: full.localUri,
          durationMs: full.durationMs,
          segments,
        };
      }

      const storyRows = await db
        .select()
        .from(stories)
        .where(eq(stories.packId, packId))
        .orderBy(asc(stories.orderIdx));
      if (storyRows.length !== 1) return null;
      const story = storyRows[0]!;
      const track = (
        await db
          .select()
          .from(audioTracks)
          .where(eq(audioTracks.packId, packId))
          .orderBy(asc(audioTracks.id))
          .limit(1)
      )[0];
      if (!track) return null;
      return {
        kind: 'single',
        ...base,
        voice: track.voice,
        uri: track.localUri,
        durationMs: track.durationMs,
        segments: [
          {
            storyId: story.id,
            trackId: track.id,
            titleRu: story.titleRu,
            orderIdx: story.orderIdx,
            startMs: 0,
            endMs: track.durationMs,
          },
        ],
      };
    },

    /** One map entry per requested pack id ('none' when there is no source). */
    async listListenAvailability(packIds: string[]): Promise<Map<string, ListenAvailability>> {
      const out = new Map<string, ListenAvailability>();
      for (const id of packIds) out.set(id, NONE);
      if (packIds.length === 0) return out;

      const fullRows = await db
        .select()
        .from(packFullAudio)
        .where(inArray(packFullAudio.packId, packIds));
      for (const f of fullRows) {
        out.set(f.packId, {
          state: f.localUri ? 'ready' : 'pending',
          parts: f.segments.length,
          durationMs: f.durationMs,
          voice: f.voice,
        });
      }

      const rest = packIds.filter((id) => !fullRows.some((f) => f.packId === id));
      const singles = await singleStoryPackIds(rest);
      if (singles.size > 0) {
        const tracks = await db
          .select()
          .from(audioTracks)
          .where(inArray(audioTracks.packId, [...singles]))
          .orderBy(asc(audioTracks.id));
        const first = new Map<string, (typeof tracks)[number]>();
        for (const t of tracks) if (!first.has(t.packId)) first.set(t.packId, t);
        for (const [packId, t] of first) {
          out.set(packId, {
            state: t.localUri ? 'ready' : 'pending',
            parts: 1,
            durationMs: t.durationMs,
            voice: t.voice,
          });
        }
      }
      return out;
    },

    /** Dev readout: full-track rows with/without a staged file, covers with/without a staged uri. */
    async countFullTracks(): Promise<{
      fullWithUri: number;
      fullWithoutUri: number;
      coverWithUri: number;
      coverWithoutUri: number;
    }> {
      const full = await db.select({ localUri: packFullAudio.localUri }).from(packFullAudio);
      const covers = await db
        .select({ coverLocalUri: packs.coverLocalUri })
        .from(packs)
        .where(sql`${packs.coverFile} IS NOT NULL`);
      return {
        fullWithUri: full.filter((r) => r.localUri).length,
        fullWithoutUri: full.filter((r) => !r.localUri).length,
        coverWithUri: covers.filter((r) => r.coverLocalUri).length,
        coverWithoutUri: covers.filter((r) => !r.coverLocalUri).length,
      };
    },

    /** Sync backfill: the full-track + cover files a pack declares and where they are staged. */
    async getStagedRefs(packId: string): Promise<{
      fullFile: string | null;
      fullLocalUri: string | null;
      coverFile: string | null;
      coverLocalUri: string | null;
    }> {
      const pack = (await db.select().from(packs).where(eq(packs.id, packId)).limit(1))[0];
      const full = (
        await db.select().from(packFullAudio).where(eq(packFullAudio.packId, packId)).limit(1)
      )[0];
      return {
        fullFile: full?.file ?? null,
        fullLocalUri: full?.localUri ?? null,
        coverFile: pack?.coverFile ?? null,
        coverLocalUri: pack?.coverLocalUri ?? null,
      };
    },

    /** Backfill / reuse: record the staged uri of the stitched track. */
    async setFullAudioLocalUri(packId: string, localUri: string | null): Promise<void> {
      await db.update(packFullAudio).set({ localUri }).where(eq(packFullAudio.packId, packId));
    },

    /** Backfill / reuse: record the staged uri of the cover image. */
    async setCoverLocalUri(packId: string, localUri: string | null): Promise<void> {
      await db.update(packs).set({ coverLocalUri: localUri }).where(eq(packs.id, packId));
    },
  };
}

export type ListenRepo = ReturnType<typeof createListenRepo>;
