import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { repos } from '@/db';

import { catalog, LISTENING_MODE, type ListeningSegment } from './catalog';
import { exposureCount } from './attempt';
import { createDraftStore, newDraft } from './draft';
import { resolveSegment } from './source';
import { bundledSegmentAudio } from './bundled-audio';

export const draftStore = createDraftStore(AsyncStorage);
export const historyKey = ['listening-lab-history'];
export function useLabHistory() {
  return useQuery({
    queryKey: historyKey,
    queryFn: () => repos.learningSessions.list(LISTENING_MODE, 10000),
  });
}
export function useLabSession(segment: ListeningSegment) {
  return useQuery({
    queryKey: ['listening-lab-session', segment.id, catalog.version],
    staleTime: Infinity,
    // An entry always gets a fresh draft/read, even if the Query cache held a previous final.
    gcTime: 0,
    queryFn: async () => {
      const [detail, rows, saved] = await Promise.all([
        repos.content.getStoryDetail(segment.source.packId, segment.source.storyId),
        repos.learningSessions.list(LISTENING_MODE, 10000),
        draftStore.read(segment.id),
      ]);
      const stamps = detail
        ? await repos.content.getWordStamps(
            segment.source.packId,
            segment.source.storyId,
            segment.source.trackId,
          )
        : [];
      const loaded = resolveSegment(segment, detail, stamps, (uri) => {
        try {
          return new File(uri).exists;
        } catch {
          return false;
        }
      });
      // A crash after the atomic final insert but before draft deletion must not reopen an editable final.
      const finalized = saved && rows.some((row) => row.id === saved.id);
      if (finalized) await draftStore.remove(segment.id);
      const draft =
        saved && !finalized
          ? saved
          : newDraft(
              segment,
              Crypto.randomUUID(),
              Date.now(),
              exposureCount(rows, segment.id),
              false,
            );
      // Preserve source eligibility, then play a bounded native file. A JS stall
      // can no longer run the original track into the neighbouring sentence.
      return {
        loaded: loaded.available
          ? { available: true as const, audio: await bundledSegmentAudio(segment.id) }
          : loaded,
        draft,
      };
    },
  });
}
