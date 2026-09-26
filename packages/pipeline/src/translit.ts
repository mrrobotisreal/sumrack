/**
 * EN → Cyrillic transliteration (T56, SPEAKING_SCENARIOS §2.3 / §3, ADR-0019
 * decision 4): how the Russian zipformer ASR *tends to hear* an English word
 * spoken inside «Как сказать <english>?». Deterministic, data-driven, and
 * heuristic by design — it produces CANDIDATES, not truth. Where English
 * spelling is ambiguous a rule yields several alternatives and the product of
 * alternatives is enumerated (primary-first, capped), so a glossary entry's
 * `translit` list covers the likely garbles; the draft's hand-written extras
 * are merged on top (see {@link mergeTranslit}) and never fight the table.
 *
 * The T59 benchmark refines the table from real device recordings (scripts
 * file Appendix B note) — keep every rule here as data, never as code paths.
 */

/** One rule: an English grapheme sequence → one or more Cyrillic renderings (primary first). */
export interface TranslitRule {
  /** Lowercase English graphemes, matched longest-first at the current position. */
  from: string;
  /** Cyrillic alternatives; the first is the primary rendering. */
  to: readonly string[];
  /** Positional constraint. */
  where?: 'initial' | 'final';
}

/** Emitted-candidate cap per word (the product of alternatives can explode). */
export const TRANSLIT_MAX_CANDIDATES = 16;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Multi-letter rules, longest-first within the table's scan (the matcher
 * sorts by `from.length` descending, table order breaks ties). Specific
 * exceptions («ceipt», «ange») sit here as data, exactly like digraphs.
 */
export const TRANSLIT_RULES: readonly TranslitRule[] = [
  // --- specific spellings ------------------------------------------------
  { from: 'ceipt', to: ['сит'] },
  { from: 'tion', to: ['шн', 'шен'] },
  { from: 'sion', to: ['жн', 'шн'] },
  { from: 'ange', to: ['эйндж', 'ейндж'] },
  { from: 'are', to: ['эр', 'еа'], where: 'final' },
  { from: 'ire', to: ['айр', 'айер'], where: 'final' },
  { from: 'ore', to: ['ор'], where: 'final' },
  { from: 'ure', to: ['юр', 'ур'], where: 'final' },
  { from: 'ough', to: ['о', 'ау', 'аф'] },
  { from: 'igh', to: ['ай'] },
  { from: 'dge', to: ['дж'] },
  { from: 'tch', to: ['ч', 'тч'] },
  { from: 'gue', to: ['ге'] },
  // --- consonant digraphs ------------------------------------------------
  { from: 'th', to: ['т', 'с', 'ф', 'з'] },
  { from: 'sh', to: ['ш'] },
  { from: 'ch', to: ['ч', 'к'] },
  { from: 'ph', to: ['ф'] },
  { from: 'wh', to: ['у', 'в'] },
  { from: 'ck', to: ['к'] },
  { from: 'qu', to: ['кв'] },
  { from: 'kn', to: ['н'], where: 'initial' },
  { from: 'wr', to: ['р'], where: 'initial' },
  { from: 'ng', to: ['нг'], where: 'final' },
  { from: 'gh', to: ['г'] },
  // doubled consonants: single by default (Russian hears one), doubled as an alternative
  { from: 'll', to: ['л', 'лл'] },
  { from: 'ss', to: ['с', 'сс'] },
  { from: 'cc', to: ['к', 'кк'] },
  { from: 'tt', to: ['т', 'тт'] },
  { from: 'pp', to: ['п'] },
  { from: 'nn', to: ['н'] },
  { from: 'mm', to: ['м'] },
  { from: 'rr', to: ['р'] },
  { from: 'ff', to: ['ф'] },
  { from: 'gg', to: ['г'] },
  { from: 'dd', to: ['д'] },
  { from: 'bb', to: ['б'] },
  { from: 'zz', to: ['з'] },
  // --- vowel digraphs ----------------------------------------------------
  { from: 'oo', to: ['у'] },
  { from: 'ee', to: ['и'] },
  { from: 'ea', to: ['и', 'э', 'е'] },
  { from: 'ie', to: ['и'] },
  { from: 'ei', to: ['и', 'эй'] },
  { from: 'ou', to: ['ау'] },
  { from: 'ow', to: ['ау', 'оу'] },
  { from: 'ay', to: ['эй'] },
  { from: 'ai', to: ['эй'] },
  { from: 'oi', to: ['ой'] },
  { from: 'oy', to: ['ой'] },
  { from: 'oa', to: ['оу', 'о'] },
  { from: 'aw', to: ['о'] },
  { from: 'au', to: ['о'] },
  { from: 'ew', to: ['ю'] },
  { from: 'eu', to: ['ю'] },
  { from: 'ue', to: ['у'], where: 'final' },
  // --- r-colored vowels --------------------------------------------------
  { from: 'ur', to: ['ёр', 'ор', 'ур'] },
  { from: 'ir', to: ['ёр', 'ир'] },
  { from: 'er', to: ['ер', 'а'], where: 'final' },
  { from: 'or', to: ['ор'] },
  { from: 'ar', to: ['ар'] },
];

/** Single letters. Context-sensitive ones (c, g, s, e, y) are resolved in {@link letterAlternatives}. */
const LETTERS: Readonly<Record<string, readonly string[]>> = {
  a: ['а', 'э'],
  b: ['б'],
  d: ['д'],
  f: ['ф'],
  h: ['х'],
  i: ['и', 'ай'],
  j: ['дж'],
  k: ['к'],
  l: ['л'],
  m: ['м'],
  n: ['н'],
  o: ['о', 'а'],
  p: ['п'],
  q: ['к'],
  r: ['р'],
  t: ['т'],
  u: ['у', 'а'],
  v: ['в'],
  w: ['у', 'в'],
  x: ['кс'],
  z: ['з'],
};

/** Long-vowel renderings for the «magic e» pattern V + C + e (primary first). */
const MAGIC_E: Readonly<Record<string, readonly string[]>> = {
  a: ['эй', 'ей'],
  i: ['ай', 'и'],
  o: ['о', 'оу'],
  u: ['ю', 'у'],
  e: ['и', 'е'],
  y: ['ай'],
};

/** Suffixes after which a «magic e» stays silent («basement», «lately», «hopeless»). */
const SILENT_E_SUFFIXES = ['ment', 'ly', 'less', 'ness', 'ful', 's', 'd'];

/** Consonant digraphs that count as ONE consonant inside the magic-e pattern. */
const MAGIC_E_CONSONANTS = [
  'ch',
  'sh',
  'th',
  'ph',
  'c',
  'd',
  'g',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'v',
  'z',
  'b',
  'f',
];

const SORTED_RULES = [...TRANSLIT_RULES].sort((a, b) => b.from.length - a.from.length);

function letterAlternatives(word: string, i: number): readonly string[] {
  const ch = word[i]!;
  const prev = word[i - 1];
  const next = word[i + 1];
  const soft = next !== undefined && (next === 'e' || next === 'i' || next === 'y');
  switch (ch) {
    case 'c':
      return soft ? ['с'] : ['к'];
    case 'g':
      return soft ? ['дж', 'г'] : ['г'];
    case 's': {
      const betweenVowels =
        prev !== undefined && VOWELS.has(prev) && next !== undefined && VOWELS.has(next);
      if (betweenVowels) return ['з', 'с'];
      const finalAfterVowel = next === undefined && prev !== undefined && VOWELS.has(prev);
      return finalAfterVowel ? ['с', 'з'] : ['с'];
    }
    case 'e':
      if (next === undefined) return ['']; // silent final e
      return i === 0 ? ['э', 'и'] : ['е', 'и'];
    case 'y':
      return i === 0 ? ['й'] : ['и'];
    default:
      return LETTERS[ch] ?? [];
  }
}

/** Match the «magic e» pattern at `i`: vowel + one consonant (or digraph) + e, where that e is silent. */
function magicE(word: string, i: number): { alternatives: string[]; length: number } | null {
  const v = word[i]!;
  const vowelAlts = MAGIC_E[v];
  if (vowelAlts === undefined) return null;
  for (const c of MAGIC_E_CONSONANTS) {
    if (!word.startsWith(c, i + 1)) continue;
    const eAt = i + 1 + c.length;
    if (word[eAt] !== 'e') continue;
    // The e must be silent: word-final («police», «tire») or followed by a
    // suffix («basement», «lately»); otherwise it is pronounced («hotel», «fever»).
    const rest = word.slice(eAt + 1);
    if (rest !== '' && !SILENT_E_SUFFIXES.some((suf) => rest === suf)) continue;
    // Resolve the consonant IN CONTEXT (so «c» before this e is soft: police → полис).
    const inner = translitAt(word, i + 1);
    if (inner === null || inner.length !== c.length) continue;
    const alternatives = vowelAlts.flatMap((va) => inner.alternatives.map((ca) => va + ca));
    return { alternatives, length: c.length + 2 };
  }
  return null;
}

/** The rule (or letter) matching at position `i` of `word`. `end` bounds the scan (for digraph lookups). */
function translitAt(
  word: string,
  i: number,
  end = word.length,
): { alternatives: readonly string[]; length: number } | null {
  for (const rule of SORTED_RULES) {
    if (i + rule.from.length > end) continue;
    if (!word.startsWith(rule.from, i)) continue;
    if (rule.where === 'initial' && i !== 0) continue;
    if (rule.where === 'final' && i + rule.from.length !== end) continue;
    return { alternatives: rule.to, length: rule.from.length };
  }
  const single = letterAlternatives(word, i);
  return single.length > 0 ? { alternatives: single, length: 1 } : null;
}

/**
 * Transliterate ONE lowercase ASCII word into its candidate set (primary
 * candidate first, ≤ {@link TRANSLIT_MAX_CANDIDATES}, deduped, NFC).
 */
function transliterateWord(word: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (i: number, acc: string): void => {
    if (out.length >= TRANSLIT_MAX_CANDIDATES) return;
    if (i >= word.length) {
      const c = acc.normalize('NFC');
      if (c !== '' && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
      return;
    }
    // Digraph/specific rules win over the magic-e pattern (e.g. «ange», «ire»),
    // and the pattern wins over the bare vowel letter.
    const rule = translitAt(word, i);
    const magic = rule !== null && rule.length > 1 ? null : magicE(word, i);
    const step = magic ?? rule;
    if (step === null) {
      walk(i + 1, acc); // unknown character: skipped
      return;
    }
    for (const alt of step.alternatives) walk(i + step.length, acc + alt);
  };
  walk(0, '');
  return out;
}

/**
 * Transliterate an English word or short phrase («gas station») into Cyrillic
 * candidates as the RU ASR tends to emit them. Case-insensitive; anything
 * that is not a letter or a space is dropped. Multi-word input yields the
 * space-joined product of per-word candidates (primary-first, capped).
 */
export function transliterate(en: string): string[] {
  const words = en
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return [];
  let acc: string[] = [''];
  for (const word of words) {
    const cands = transliterateWord(word);
    if (cands.length === 0) continue;
    const next: string[] = [];
    for (const a of acc) {
      for (const c of cands) {
        if (next.length >= TRANSLIT_MAX_CANDIDATES) break;
        next.push(a === '' ? c : `${a} ${c}`);
      }
    }
    acc = next;
  }
  return acc.filter((c) => c !== '');
}

/**
 * The glossary entry's final `translit` list: the draft's hand-written extras
 * FIRST (an author override is the best guess), then the generated
 * candidates, deduped after NFC + lowercase.
 */
export function mergeTranslit(generated: readonly string[], extras: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...extras, ...generated]) {
    const c = raw.normalize('NFC').trim().toLowerCase();
    if (c === '' || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
