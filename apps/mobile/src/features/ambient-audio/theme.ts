import type { AmbientThemeId } from './beds';

/**
 * Which study soundtrack a classified pack gets (design AMBIENT_SOUNDTRACKS
 * §3.2). Pure function of the M14 classification (`classifyPack(pack)`):
 * category decides first (`torfl` shares the education beds), genre only
 * matters under `stories`, and everything
 * else — other genres, podcast/documentary/travel, dialogues, games,
 * unclassified imports — takes the horror default.
 */
export function resolveAmbientTheme(c: {
  category: string;
  genre: string | null | undefined;
}): AmbientThemeId {
  if (c.category === 'news') return 'news';
  if (c.category === 'education') return 'education';
  // M18 (T69, TORFL §5.1): exam prep studies to the education beds.
  if (c.category === 'torfl') return 'education';
  if (c.category === 'stories' && c.genre === 'comedy') return 'comedy';
  if (c.category === 'stories' && c.genre === 'action') return 'action';
  return 'horror';
}
