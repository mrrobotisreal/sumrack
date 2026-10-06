import type { ExamSubtest } from '@sumrak/schema';

import type { Repositories } from '@/db/repositories';

import { loadItemAssets, type ItemAssets } from '../items/exam-audio';
import { buildLayout } from './layout';

/**
 * Subtest assets for a mock (T71). Reading passages load lazily per item
 * (cached by the executor); LISTENING is preflighted up front: every audio
 * group must resolve to a real file on disk — a mock never falls back to TTS
 * (TORFL §12: «Скачай аудио по Wi-Fi»), unlike drills.
 */

type ContentRepo = Pick<Repositories['content'], 'getStoryDetail' | 'getWordStamps'>;

export interface ListeningPreflight {
  /** audioKey → resolved assets of the group's first item. */
  byKey: Map<string, ItemAssets>;
  /** Audio keys with no playable file (TTS-only, or the story is gone). */
  missing: string[];
}

/** Pure: the audio keys whose assets are absent or synthetic. */
export function missingAudioKeys(byKey: ReadonlyMap<string, ItemAssets>): string[] {
  const out: string[] = [];
  for (const [key, assets] of byKey) {
    if (!assets.audio || assets.audio.synthetic) out.push(key);
  }
  return out;
}

export async function preflightListening(
  content: ContentRepo,
  packId: string,
  subtest: ExamSubtest,
  fileExists: (uri: string) => boolean,
): Promise<ListeningPreflight> {
  const layout = buildLayout(subtest);
  const byKey = new Map<string, ItemAssets>();
  for (const group of layout.groups) {
    if (group.audioKey === null) continue;
    const first = layout.items[group.start]!;
    const part = subtest.parts[first.partIdx]!;
    const item = part.items[first.itemIdx]!;
    byKey.set(
      group.audioKey,
      await loadItemAssets(content, packId, part, first.itemIdx, item, fileExists),
    );
  }
  return { byKey, missing: missingAudioKeys(byKey) };
}
