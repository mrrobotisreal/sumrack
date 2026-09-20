import { formatRuDate } from '@/lib/ru-date';

/** Story provenance (M14 §2.2 → the four `stories.source_*` columns). */
export interface StorySourceProps {
  name: string;
  url: string | null;
  publishedAt: string | null;
  author: string | null;
}

/**
 * Reader-header source line (M14 §5, T46): `name · 14 сент. 2026 · author`
 * — missing parts omitted, order fixed. Pure (no RN import) so the fixture
 * shapes are pinned by a unit test; the header decides pressability from
 * `url` separately.
 */
export function formatSourceLine(source: StorySourceProps): string {
  const parts = [source.name];
  if (source.publishedAt) parts.push(formatRuDate(source.publishedAt));
  if (source.author) parts.push(source.author);
  return parts.join(' · ');
}
