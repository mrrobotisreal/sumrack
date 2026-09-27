import type { AudioPlayer } from 'expo-audio';
import * as React from 'react';

import type { SentenceWithTokens } from '@/db/repositories/content';
import { activeWordAt, buildKaraokeIndex } from '@/features/reader/karaoke';

/**
 * Subtitles karaoke (T62 §9.3, «training wheels»): the current host line's
 * active word from the T27 one-sentence `buildKaraokeIndex` over the line's
 * stamps + the player's position, ticked at 120 ms. Off ⇒ nothing runs.
 * Never the learner's transcript — only the host's sentence goes in.
 */

const TICK_MS = 120;

export function useSubtitleKaraoke(opts: {
  enabled: boolean;
  player: AudioPlayer | null;
  sentence: Pick<SentenceWithTokens, 'id' | 'ru'> | null;
  stamps: readonly { tokenIndex: number; startMs: number; endMs: number }[] | undefined;
  durationMs: number | null;
}): { tokenIndex: number | null; sentenceWash: boolean } {
  const { enabled, player, sentence, stamps, durationMs } = opts;
  const hasStamps = (stamps?.length ?? 0) > 0;
  const key = sentence ? `${sentence.id}|${durationMs ?? 0}` : '';
  // Keyed by line so a line change needs no reset write (the T27 pattern).
  const [karaoke, setKaraoke] = React.useState<{ key: string; tokenIndex: number | null } | null>(
    null,
  );

  React.useEffect(() => {
    if (!enabled || !player || !sentence || !hasStamps) return;
    const index = buildKaraokeIndex(
      [{ id: sentence.id, ru: sentence.ru }],
      (stamps ?? []).map((s) => ({ sentenceId: sentence.id, ...s })),
      durationMs ?? 0,
    );
    const id = setInterval(() => {
      let ms = 0;
      try {
        ms = Math.round(player.currentTime * 1000);
      } catch {
        return; // released under us — the next line remounts this effect
      }
      const active = activeWordAt(index, ms);
      const tokenIndex = active ? active.tokenIndex : null;
      setKaraoke((prev) =>
        prev?.key === key && prev.tokenIndex === tokenIndex ? prev : { key, tokenIndex },
      );
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, player, sentence, stamps, hasStamps, durationMs, key]);

  const live = enabled && player != null && sentence != null;
  return {
    tokenIndex: live && hasStamps && karaoke?.key === key ? karaoke.tokenIndex : null,
    sentenceWash: live && !hasStamps,
  };
}
