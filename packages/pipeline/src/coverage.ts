import { scenarioLines, type GlossaryEntry, type Scenario } from '@sumrak/schema';

/**
 * Glossary coverage report (T56, SCENARIOS §2.3): every CONTENT lemma the
 * cast says — across turn lines, retry lines, reject reactions and nudges —
 * that is not a glossary headword, with how often it is said. The CT rule is
 * "cover every content word the host says" (plus the family's «likely
 * how-to-say» English list, which is a CT-session rule and not checked here).
 *
 * Content = a word token whose `pos` is in {@link CONTENT_POS} and whose
 * lemma is not in {@link COVERAGE_STOP_LEMMAS}. Function words (pronouns,
 * prepositions, conjunctions, particles, interjections, predicatives such as
 * «можно»/«есть»), numerals (`num` — the judge's numeral machinery owns them,
 * SCENARIOS §5.1) and proper names (`name`) never count. Glossary clips
 * themselves («Живот — это stomach.») are NOT scanned — they are meta-speech
 * about the glossary, not the scenario's own vocabulary.
 *
 * A lemma counts as covered when it equals an entry's headword `ru` OR one of
 * the entry's `forms` (exact, or a trailing-`*` glob as a prefix) — «зовут»
 * with `forms: зовут, звать` covers the lemma «звать». Matching is NFC,
 * lowercase, ё/е-tolerant.
 */

/** The token-table POS values counted as content words. */
export const CONTENT_POS: ReadonlySet<string> = new Set(['noun', 'verb', 'adj', 'adv']);

/**
 * Adverb-class stopwords the judge never counts as content (the SCENARIOS
 * §5.1 `STOP_RU` list — the app's copy lands in T60; this mirror keeps the
 * coverage report and the judge in agreement). Pronouns/particles/preps are
 * already excluded by POS; these are the adverbs and `что`/`как` family.
 */
export const COVERAGE_STOP_LEMMAS: ReadonlySet<string> = new Set([
  'я',
  'ты',
  'мы',
  'вы',
  'и',
  'а',
  'но',
  'да',
  'нет',
  'ну',
  'вот',
  'это',
  'в',
  'на',
  'у',
  'с',
  'к',
  'о',
  'же',
  'ли',
  'не',
  'что',
  'как',
  'так',
  'там',
  'тут',
  'очень',
  'пожалуйста',
  'спасибо',
]);

export interface CoverageGap {
  /** The lemma as authored (first occurrence's spelling), ё preserved. */
  lemma: string;
  pos: string;
  /** How many times the cast says a token with this lemma. */
  count: number;
  /** Sentence ids where it occurs (declaration order, deduped). */
  sentenceIds: string[];
}

export interface CoverageReport {
  scenarioId: string;
  /** Distinct content lemmas the cast says. */
  contentLemmas: number;
  /** Of those, how many are glossary headwords. */
  covered: number;
  gaps: CoverageGap[];
}

/** ё/е-tolerant, case-insensitive, NFC key. */
export function lemmaKey(s: string): string {
  return s.normalize('NFC').toLowerCase().replaceAll('ё', 'е');
}

/** Does a glossary entry cover this lemma key (headword, exact form, or glob prefix)? */
function entryCovers(entry: GlossaryEntry, key: string): boolean {
  if (lemmaKey(entry.ru) === key) return true;
  return entry.forms.some((form) => {
    const f = lemmaKey(form);
    return f.endsWith('*') ? key.startsWith(f.slice(0, -1)) : f === key;
  });
}

export function glossaryCoverage(scenario: Scenario): CoverageReport {
  const covered = (key: string) => scenario.glossary.some((g) => entryCovers(g, key));
  const said = new Map<string, CoverageGap>();
  for (const ref of scenarioLines(scenario)) {
    if (ref.kind === 'explain' || ref.kind === 'howtosay') continue;
    const sentence = ref.line.sentence;
    for (const token of sentence.tokens) {
      if (token.isPunct || token.lemma === undefined || token.pos === undefined) continue;
      if (!CONTENT_POS.has(token.pos)) continue;
      const key = lemmaKey(token.lemma);
      if (COVERAGE_STOP_LEMMAS.has(key)) continue;
      const gap = said.get(key);
      if (gap) {
        gap.count += 1;
        if (!gap.sentenceIds.includes(sentence.id)) gap.sentenceIds.push(sentence.id);
      } else {
        said.set(key, { lemma: token.lemma, pos: token.pos, count: 1, sentenceIds: [sentence.id] });
      }
    }
  }
  const gaps = [...said.entries()]
    .filter(([key]) => !covered(key))
    .map(([, gap]) => gap)
    .sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma, 'ru'));
  return {
    scenarioId: scenario.id,
    contentLemmas: said.size,
    covered: said.size - gaps.length,
    gaps,
  };
}

export function renderCoverageReport(report: CoverageReport): string {
  const head = `Glossary coverage — ${report.scenarioId}: ${report.covered}/${report.contentLemmas} content lemmas covered`;
  if (report.gaps.length === 0) return `${head} ✓`;
  const lines = report.gaps.map(
    (g) => `  ! «${g.lemma}» (${g.pos}) ×${g.count} — ${g.sentenceIds.join(', ')}`,
  );
  return [`${head} — ${report.gaps.length} uncovered:`, ...lines].join('\n');
}
