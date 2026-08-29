import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';

/**
 * The pack's `theme` for a screen that only receives a packId (lesson and
 * quiz routes carry no pack row — T30 left the columns on `packs`). Local
 * DB read, resolves in ms; scene layers simply appear once known.
 */
export function usePackTheme(packId: string): { scene: string | null; accent: string | null } {
  const query = useQuery({
    queryKey: ['pack-theme', packId],
    queryFn: () => repos.content.getPack(packId),
  });
  return {
    scene: query.data?.themeScene ?? null,
    accent: query.data?.themeAccent ?? null,
  };
}
