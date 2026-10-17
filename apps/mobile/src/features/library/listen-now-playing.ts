import { useListenStore } from '@/features/listen/listen-service';

/** Pack id of the full-story session now playing (T96 store), or null. */
export function useListenNowPlaying(): string | null {
  return useListenStore((s) => (s.playing ? (s.session?.source.packId ?? null) : null));
}
