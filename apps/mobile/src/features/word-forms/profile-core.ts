import type { BankItemRow } from '@/db/repositories/bank';
import type { ProfileKind } from '@/db/schema/user';

import { STRESS, type ProfileLanguage, type ProfilePos, type WordProfile } from './profile-schema';

/**
 * Pure word-profile core (M16/T52, WORD_FORMS §5.2–§5.4): the section
 * catalog, the structural validator that runs AFTER the Zod parse, the
 * prompt renderer for the catalog, and the profile-key helper. No DB, no
 * network, no React — unit-tested exhaustively.
 *
 * The catalog is the single source of truth: the validator's fixed labels
 * and the prompt's FIXED lines both come from `SECTION_CATALOG`, so the
 * prompt and the validator can never disagree (ticket technical note).
 */

// --- §5.3 fixed labels -------------------------------------------------------

/** Case row labels (★ fixed, verbatim). `uk` adds the vocative for Сутінки later. */
export const CASES: Record<ProfileLanguage, readonly string[]> = {
  ru: [
    'Nom. — именительный',
    'Gen. — родительный',
    'Dat. — дательный',
    'Acc. — винительный',
    'Ins. — творительный',
    'Prep. — предложный',
  ],
  uk: [
    'Nom. — именительный',
    'Gen. — родительный',
    'Dat. — дательный',
    'Acc. — винительный',
    'Ins. — творительный',
    'Prep. — предложный',
    'Voc. — кличний',
  ],
};
/** Person rows ★. */
export const PERSONS: readonly string[] = ['я', 'ты', 'он / она / оно', 'мы', 'вы', 'они'];
/** Gender rows ★. */
export const GENDERS: readonly string[] = ['masc. (он)', 'fem. (она)', 'neut. (оно)', 'pl. (они)'];

// --- §5.3 the catalog --------------------------------------------------------

export interface CatalogEntry {
  id: string;
  title: { en: string; ru: string };
  layout: 'grid' | 'list';
  /**
   * Fixed row labels (★): a literal list, or `'cases'` = `CASES[language]`.
   * Absent for list sections and for grids whose rows are free.
   */
  fixedRows?: readonly string[] | 'cases';
  /** Column labels for grids; absent = chosen by the model (≥ 1). */
  colLabels?: readonly string[];
  /** POS values for which the section MUST be present (§5.2 rule 3). */
  requiredFor: readonly ProfilePos[];
  /** Content rule shown to the model, from §5.3. */
  rule: string;
}

const DECLENSION_FREE_COLS =
  'cols chosen by the model (≥ 1); recommended, not enforced — indeclinables legitimately omit it: indeclinable → no section + an overview note saying so';

export const SECTION_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'verb-nonpast',
    title: { en: 'Present & future', ru: 'Настоящее и будущее' },
    layout: 'grid',
    fixedRows: PERSONS,
    colLabels: ['Present', 'Future'],
    requiredFor: ['verb'],
    rule: 'imperfective: present forms + compound future («бу́ду говори́ть»); perfective: Present column all null + note "perfective verbs have no present", Future = simple future',
  },
  {
    id: 'verb-past',
    title: { en: 'Past & conditional', ru: 'Прошедшее и условное' },
    layout: 'grid',
    fixedRows: GENDERS,
    colLabels: ['Past', 'Conditional (бы)'],
    requiredFor: ['verb'],
    rule: '',
  },
  {
    id: 'verb-imperative',
    title: { en: 'Imperative', ru: 'Повелительное' },
    layout: 'grid',
    fixedRows: ['ты', 'вы'],
    colLabels: ['Imperative'],
    requiredFor: ['verb'],
    rule: 'note on aspect choice in commands/prohibitions',
  },
  {
    id: 'verb-participles',
    title: { en: 'Participles', ru: 'Причастия' },
    layout: 'grid',
    fixedRows: [
      'Present active',
      'Past active',
      'Present passive',
      'Past passive',
      'Past passive short (m / f / n / pl)',
    ],
    colLabels: ['Form'],
    requiredFor: ['verb'],
    rule: 'non-existent → null + note (e.g. intransitive ⇒ no passives)',
  },
  {
    id: 'verb-gerunds',
    title: { en: 'Verbal adverbs', ru: 'Деепричастия' },
    layout: 'list',
    requiredFor: ['verb'],
    rule: 'rows: present gerund, past gerund(s); gloss "while …ing" / "having …ed"',
  },
  {
    id: 'verb-family',
    title: { en: 'Aspect pair & word family', ru: 'Видовая пара и семья слова' },
    layout: 'list',
    requiredFor: ['verb'],
    rule: '≤ 14 rows total (validator-enforced); row 1 = aspect partner (tags ["partner", "pf"|"impf"]), then prefixed/derived verbs by frequency (tags ["pf"|"impf", "prefix:по-"]), reflexive counterparts (["refl"]), then nouns/adjectives/adverbs from the root (["noun"] …); every row has a gloss with the nuance ("to have a talk (completed)")',
  },
  {
    id: 'verb-government',
    title: { en: 'Government & collocations', ru: 'Управление и сочетаемость' },
    layout: 'list',
    requiredFor: ['verb'],
    rule: 'rows = pattern in Cyrillic only (ru «говори́ть с кем-либо», gloss "to talk with someone — с + instr.") + example',
  },
  {
    id: 'noun-declension',
    title: { en: 'Declension', ru: 'Склонение' },
    layout: 'grid',
    fixedRows: 'cases',
    colLabels: ['Singular', 'Plural'],
    requiredFor: ['noun'],
    rule: 'singularia/pluralia tantum → whole column null + note; animate accusative shown as is',
  },
  {
    id: 'noun-family',
    title: { en: 'Word family', ru: 'Семья слова' },
    layout: 'list',
    requiredFor: ['noun'],
    rule: 'diminutive/augmentative, adjective(s), verb(s), person nouns; tags ["dim"] ["aug"] ["adj"] ["verb"]',
  },
  {
    id: 'noun-collocations',
    title: { en: 'Collocations & usage', ru: 'Сочетаемость' },
    layout: 'list',
    requiredFor: [],
    rule: 'pattern + gloss + example',
  },
  {
    id: 'adj-long',
    title: { en: 'Long-form declension', ru: 'Полная форма' },
    layout: 'grid',
    fixedRows: 'cases',
    colLabels: ['Masc.', 'Fem.', 'Neut.', 'Plural'],
    requiredFor: ['adj'],
    rule: 'animate/inanimate accusative as «но́вый / но́вого» in one cell + note',
  },
  {
    id: 'adj-short',
    title: { en: 'Short forms', ru: 'Краткие формы' },
    layout: 'list',
    requiredFor: ['adj'],
    rule: 'rows m/f/n/pl; null-equivalent = omit the section + explain in overview.notes when the adjective has none',
  },
  {
    id: 'adj-comparison',
    title: { en: 'Comparative & superlative', ru: 'Степени сравнения' },
    layout: 'list',
    requiredFor: ['adj'],
    rule: 'simple + compound comparative, simple + compound superlative',
  },
  {
    id: 'adj-adverb',
    title: { en: 'Adverb', ru: 'Наречие' },
    layout: 'list',
    requiredFor: [],
    rule: '',
  },
  {
    id: 'adj-family',
    title: { en: 'Word family', ru: 'Семья слова' },
    layout: 'list',
    requiredFor: [],
    rule: '',
  },
  {
    id: 'pron-declension',
    title: { en: 'Declension', ru: 'Склонение' },
    layout: 'grid',
    fixedRows: 'cases',
    requiredFor: [],
    rule: `pron: ${DECLENSION_FREE_COLS}`,
  },
  {
    id: 'num-declension',
    title: { en: 'Declension', ru: 'Склонение' },
    layout: 'grid',
    fixedRows: 'cases',
    requiredFor: [],
    rule: `num: ${DECLENSION_FREE_COLS}`,
  },
  {
    id: 'name-declension',
    title: { en: 'Declension', ru: 'Склонение' },
    layout: 'grid',
    fixedRows: 'cases',
    requiredFor: [],
    rule: `name: ${DECLENSION_FREE_COLS}`,
  },
  {
    id: 'usage',
    title: { en: 'Usage & patterns', ru: 'Употребление' },
    layout: 'list',
    requiredFor: ['adv', 'prep', 'conj', 'part', 'other'],
    rule: 'meanings, patterns, register, example each (any POS may add it)',
  },
  {
    id: 'related',
    title: { en: 'Related forms', ru: 'Родственные формы' },
    layout: 'list',
    requiredFor: [],
    rule: '',
  },
  {
    id: 'phrase-structure',
    title: { en: 'Word by word', ru: 'Разбор по словам' },
    layout: 'list',
    requiredFor: ['phrase'],
    rule: 'one row per word: ru stressed, gloss = the form («gen. pl. of во́лос»), note = meaning here',
  },
  {
    id: 'phrase-usage',
    title: { en: 'Usage & register', ru: 'Употребление и стиль' },
    layout: 'list',
    requiredFor: ['phrase'],
    rule: 'situations, register, ≥ 2 examples via example',
  },
  {
    id: 'phrase-variants',
    title: { en: 'Variants & synonyms', ru: 'Варианты и синонимы' },
    layout: 'list',
    requiredFor: [],
    rule: 'variants, near-synonyms, antonyms',
  },
];

const CATALOG_BY_ID = new Map(SECTION_CATALOG.map((e, i) => [e.id, { entry: e, index: i }]));

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(id)?.entry;
}

/** The fixed row labels of an entry for a language, or null when rows are free. */
export function fixedRowLabels(
  entry: CatalogEntry,
  language: ProfileLanguage,
): readonly string[] | null {
  if (!entry.fixedRows) return null;
  return entry.fixedRows === 'cases' ? CASES[language] : entry.fixedRows;
}

/** Catalog ids whose section MUST be present for `pos`, in catalog order. */
export function requiredSectionIds(pos: ProfilePos): string[] {
  return SECTION_CATALOG.filter((e) => e.requiredFor.includes(pos)).map((e) => e.id);
}

/** `verb-family` row cap (§5.3, validator-enforced). */
export const VERB_FAMILY_MAX_ROWS = 14;

// --- §6.1 catalog rendering --------------------------------------------------

function quoteList(labels: readonly string[]): string {
  return `[${labels.map((l) => JSON.stringify(l)).join(', ')}]`;
}

/**
 * One line per catalog section — id · layout · title en/ru · FIXED rowLabels /
 * colLabels · required-for POS · content rule — spliced into the system
 * prompt's `{CATALOG_RENDERED_FROM_SECTION_CATALOG}` slot. Rendered from the
 * same table the validator enforces, never hand-copied.
 */
export function renderCatalogForPrompt(language: ProfileLanguage): string {
  return SECTION_CATALOG.map((e) => renderCatalogLine(e, language)).join('\n');
}

export function renderCatalogLine(entry: CatalogEntry, language: ProfileLanguage): string {
  const parts = [
    `- id "${entry.id}" · layout ${entry.layout} · title "${entry.title.en}" / "${entry.title.ru}"`,
  ];
  const rows = fixedRowLabels(entry, language);
  if (rows) parts.push(`rowLabels FIXED ${quoteList(rows)}`);
  if (entry.colLabels) parts.push(`colLabels ${quoteList(entry.colLabels)}`);
  else if (entry.layout === 'grid') parts.push('colLabels chosen by you (≥ 1)');
  parts.push(
    entry.requiredFor.length > 0 ? `required for ${entry.requiredFor.join(', ')}` : 'optional',
  );
  if (entry.rule) parts.push(`rule: ${entry.rule}`);
  return parts.join(' · ');
}

// --- §5.2 structural validation ---------------------------------------------

export function stripStress(s: string): string {
  return s.replaceAll(STRESS, '');
}

/** Characters a FORM (not an example sentence) may contain, once stress marks are removed. */
export const FORM_CHARS = /^[\p{Script=Cyrillic}\s\-\/(),.…!?«»]+$/u;

const VOWELS = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g;

export interface ValidationResult {
  ok: boolean;
  /** Hard failures — verbatim into the correction turn (§5.5 step 3). */
  issues: string[];
  /** Rule 6 soft checks — surfaced in the dev readout, never a failure. */
  warnings: string[];
}

function isNfc(s: string): boolean {
  return s === s.normalize('NFC');
}

/**
 * `validateProfile(p)` — rules 1–6 of WORD_FORMS §5.2 on an already
 * Zod-parsed profile. Issue strings are path-prefixed like
 * `sections[2].grid.cells[4]: expected 2 columns, got 3`.
 */
export function validateProfile(p: WordProfile): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  const checkForm = (path: string, ru: string, plain: string) => {
    if (!isNfc(ru)) issues.push(`${path}.ru: not NFC-normalized`);
    if (!isNfc(plain)) issues.push(`${path}.plain: not NFC-normalized`);
    if (plain !== stripStress(ru)) {
      issues.push(`${path}.plain: must equal ru with every U+0301 removed (got "${plain}")`);
    }
    if (!FORM_CHARS.test(plain)) {
      issues.push(
        `${path}.plain: a form may contain only Cyrillic letters, spaces and -/(),.…!?«» — no Latin letters, digits or labels (got "${plain}")`,
      );
    }
    softStressCheck(path, ru, warnings);
  };

  checkForm('headword', p.headword.ru, p.headword.plain);

  const language = p.language;
  const seen = new Set<string>();
  let lastCatalogIndex = -1;
  let sawExtra = false;

  p.sections.forEach((section, i) => {
    const path = `sections[${i}]`;
    // Rule 4: unique ids.
    if (seen.has(section.id)) issues.push(`${path}.id: duplicate section id "${section.id}"`);
    seen.add(section.id);

    // Rule 3: catalog order; x- sections last; unknown non-x ids rejected.
    const isExtra = section.id.startsWith('x-');
    const catalog = CATALOG_BY_ID.get(section.id);
    if (isExtra) {
      sawExtra = true;
    } else if (!catalog) {
      issues.push(
        `${path}.id: "${section.id}" is not a catalog id (extra sections must use an "x-" id)`,
      );
    } else {
      if (sawExtra) {
        issues.push(
          `${path}.id: catalog section "${section.id}" must come before every "x-" section`,
        );
      }
      if (catalog.index < lastCatalogIndex) {
        issues.push(`${path}.id: "${section.id}" is out of catalog order`);
      }
      lastCatalogIndex = Math.max(lastCatalogIndex, catalog.index);
      if (catalog.entry.layout !== section.layout) {
        issues.push(
          `${path}.layout: catalog section "${section.id}" is a ${catalog.entry.layout} section, got ${section.layout}`,
        );
      }
    }

    // Rule 4: layout ↔ grid/rows.
    if (section.layout === 'grid') {
      if (!section.grid) issues.push(`${path}.grid: required for layout "grid"`);
      if (section.rows) issues.push(`${path}.rows: must be absent for layout "grid"`);
    } else {
      if (!section.rows) issues.push(`${path}.rows: required for layout "list"`);
      if (section.grid) issues.push(`${path}.grid: must be absent for layout "list"`);
    }

    // Rule 2: grid dimensions + fixed labels.
    if (section.grid) {
      const { rowLabels, colLabels, cells } = section.grid;
      const fixed = catalog ? fixedRowLabels(catalog.entry, language) : null;
      if (fixed && !labelsMatch(fixed, rowLabels)) {
        issues.push(
          `${path}.grid.rowLabels: must be exactly ${quoteList(fixed)} (FIXED), got ${quoteList(rowLabels)}`,
        );
      }
      if (cells.length !== rowLabels.length) {
        issues.push(
          `${path}.grid.cells: expected ${rowLabels.length} rows (one per rowLabel), got ${cells.length}`,
        );
      }
      cells.forEach((row, r) => {
        if (row.length !== colLabels.length) {
          issues.push(
            `${path}.grid.cells[${r}]: expected ${colLabels.length} columns, got ${row.length}`,
          );
        }
        row.forEach((cell, c) => {
          if (cell) checkForm(`${path}.grid.cells[${r}][${c}]`, cell.ru, cell.plain);
        });
      });
    }

    // Rules 1 + 5 for list sections.
    if (section.rows) {
      if (section.rows.length === 0) {
        issues.push(
          `${path}.rows: a list section needs at least one row — omit the section instead (and explain in overview.notes)`,
        );
      }
      if (section.id === 'verb-family' && section.rows.length > VERB_FAMILY_MAX_ROWS) {
        issues.push(
          `${path}.rows: verb-family may have at most ${VERB_FAMILY_MAX_ROWS} rows, got ${section.rows.length}`,
        );
      }
      section.rows.forEach((row, r) => {
        checkForm(`${path}.rows[${r}]`, row.ru, row.plain);
        if (row.example && !isNfc(row.example.ru)) {
          issues.push(`${path}.rows[${r}].example.ru: not NFC-normalized`);
        }
      });
    }
  });

  // Rule 3: required sections per POS.
  for (const id of requiredSectionIds(p.pos)) {
    if (!seen.has(id)) {
      issues.push(`sections: required section "${id}" for pos "${p.pos}" is missing`);
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

function labelsMatch(expected: readonly string[], got: readonly string[]): boolean {
  if (expected.length !== got.length) return false;
  return expected.every((label, i) => label.trim() === got[i]!.trim());
}

/**
 * Rule 6 (soft): a polysyllabic form (≥ 2 vowels) that carries neither ё nor
 * any U+0301 is probably missing its stress. Checked per whitespace-/slash-
 * separated token so a half-stressed compound («бу́ду говорить») still warns.
 */
function softStressCheck(path: string, ru: string, warnings: string[]) {
  for (const token of ru.split(/[\s/]+/)) {
    if (token.includes(STRESS) || /ё/i.test(token)) continue;
    const vowels = token.match(VOWELS)?.length ?? 0;
    if (vowels >= 2) {
      warnings.push(`${path}.ru: "${token}" has ${vowels} vowels but no stress mark`);
    }
  }
}

// --- §5.4 profile key ---------------------------------------------------------

export interface ProfileKey {
  lemmaNorm: string;
  kind: ProfileKind;
}

/**
 * The profile key of a bank item — the bank dedup key: `lemma_norm` for
 * words, `normalized` for phrases. Words without a lemma (needs-enrichment
 * items) have NO key → null (the Forms tab says «Add a lemma first»).
 */
export function profileKeyFor(
  item: Pick<BankItemRow, 'kind' | 'lemmaNorm' | 'normalized'>,
): ProfileKey | null {
  if (item.kind === 'phrase') return { lemmaNorm: item.normalized, kind: 'phrase' };
  if (!item.lemmaNorm) return null;
  return { lemmaNorm: item.lemmaNorm, kind: 'word' };
}
