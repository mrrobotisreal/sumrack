/**
 * Russian calendar-date rendering for `story.source.publishedAt` (M14 §4.3
 * caption date). Born in T45's `features/library/library-filter.ts`; moved
 * here in T46 because the reader header's source line needs it too and a
 * feature module must not import another feature's internals. Pure; no
 * runtime dependency beyond `Intl`.
 */

// Genitive short month names — the ru-RU `month: 'short'` output ICU produces
// («мая» has no dot; «сент.», «нояб.», «февр.» are the standard abbreviations).
const RU_MONTHS_SHORT = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Table-driven `d MMM yyyy` — the path Hermes takes when it lacks ru-RU data. */
export function formatRuDateFallback(iso: string): string {
  const m = ISO_DATE.exec(iso);
  if (!m) return iso;
  const month = RU_MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

export type RuDatePath = 'intl' | 'fallback';

function intlRuDate(iso: string): string | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  try {
    const out = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    // Hermes ships limited locale data: without ru-RU it answers in English
    // or numerals — no Cyrillic means the table must take over. Full ICU
    // appends « г.» («14 сент. 2026 г.»); the caption spec is without it, so
    // both paths agree byte-for-byte.
    return /[Ѐ-ӿ]/.test(out) ? out.replace(/\s*г\.$/, '') : null;
  } catch {
    return null;
  }
}

/** Which path this runtime takes — printed on the dev-db screen for the device record. */
export function detectRuDatePath(): RuDatePath {
  return intlRuDate('2026-09-14') ? 'intl' : 'fallback';
}

/**
 * `'2026-09-14'` → `'14 сент. 2026'` (§4.3 caption date). Prefers
 * `Intl.DateTimeFormat('ru-RU')` when it produces Russian output, otherwise
 * the fallback table. Malformed input is returned unchanged.
 */
export function formatRuDate(iso: string): string {
  return intlRuDate(iso) ?? formatRuDateFallback(iso);
}
