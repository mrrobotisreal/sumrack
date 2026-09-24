import { describe, expect, it } from 'vitest';

import {
  CASES,
  GENDERS,
  PERSONS,
  SECTION_CATALOG,
  fixedRowLabels,
  profileKeyFor,
  renderCatalogForPrompt,
  requiredSectionIds,
  stripStress,
  validateProfile,
} from '../profile-core';
import { STRESS, WordProfileSchema } from '../profile-schema';
import { adjProfile, cell, nounProfile, phraseProfile, row, verbProfile } from './fixtures';

describe('SECTION_CATALOG (§5.3)', () => {
  it('has the 23 catalog ids in design order with unique ids', () => {
    const ids = SECTION_CATALOG.map((e) => e.id);
    expect(ids).toEqual([
      'verb-nonpast',
      'verb-past',
      'verb-imperative',
      'verb-participles',
      'verb-gerunds',
      'verb-family',
      'verb-government',
      'noun-declension',
      'noun-family',
      'noun-collocations',
      'adj-long',
      'adj-short',
      'adj-comparison',
      'adj-adverb',
      'adj-family',
      'pron-declension',
      'num-declension',
      'name-declension',
      'usage',
      'related',
      'phrase-structure',
      'phrase-usage',
      'phrase-variants',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fixed labels are verbatim: cases (ru 6 / uk 7), persons, genders', () => {
    expect(CASES.ru).toEqual([
      'Nom. — именительный',
      'Gen. — родительный',
      'Dat. — дательный',
      'Acc. — винительный',
      'Ins. — творительный',
      'Prep. — предложный',
    ]);
    expect(CASES.uk).toEqual([...CASES.ru, 'Voc. — кличний']);
    expect(PERSONS).toEqual(['я', 'ты', 'он / она / оно', 'мы', 'вы', 'они']);
    expect(GENDERS).toEqual(['masc. (он)', 'fem. (она)', 'neut. (оно)', 'pl. (они)']);
    const decl = SECTION_CATALOG.find((e) => e.id === 'noun-declension')!;
    expect(fixedRowLabels(decl, 'ru')).toBe(CASES.ru);
    expect(fixedRowLabels(decl, 'uk')).toBe(CASES.uk);
    expect(
      fixedRowLabels(
        SECTION_CATALOG.find((e) => e.id === 'usage')!,
        'ru',
      ),
    ).toBeNull();
  });

  it('required-for per POS matches the design table', () => {
    expect(requiredSectionIds('verb')).toEqual([
      'verb-nonpast',
      'verb-past',
      'verb-imperative',
      'verb-participles',
      'verb-gerunds',
      'verb-family',
      'verb-government',
    ]);
    expect(requiredSectionIds('noun')).toEqual(['noun-declension', 'noun-family']);
    expect(requiredSectionIds('adj')).toEqual(['adj-long', 'adj-short', 'adj-comparison']);
    expect(requiredSectionIds('phrase')).toEqual(['phrase-structure', 'phrase-usage']);
    for (const pos of ['adv', 'prep', 'conj', 'part', 'other'] as const) {
      expect(requiredSectionIds(pos)).toEqual(['usage']);
    }
    // Declension for pron/num/name is recommended, NOT enforced (indeclinables).
    for (const pos of ['pron', 'num', 'name'] as const) expect(requiredSectionIds(pos)).toEqual([]);
  });

  it('renderCatalogForPrompt: one line per entry, ids/titles/FIXED labels/required present', () => {
    const lines = renderCatalogForPrompt('ru').split('\n');
    expect(lines).toHaveLength(SECTION_CATALOG.length);
    SECTION_CATALOG.forEach((e, i) => {
      const line = lines[i]!;
      expect(line).toContain(`id "${e.id}"`);
      expect(line).toContain(`layout ${e.layout}`);
      expect(line).toContain(`"${e.title.en}" / "${e.title.ru}"`);
      const fixed = fixedRowLabels(e, 'ru');
      if (fixed) {
        expect(line).toContain('rowLabels FIXED');
        for (const label of fixed) expect(line).toContain(JSON.stringify(label));
      } else {
        expect(line).not.toContain('FIXED');
      }
      if (e.requiredFor.length > 0)
        expect(line).toContain(`required for ${e.requiredFor.join(', ')}`);
      else expect(line).toContain('optional');
    });
    // The Ukrainian render carries the vocative row.
    expect(renderCatalogForPrompt('uk')).toContain('Voc. — кличний');
    expect(renderCatalogForPrompt('ru')).not.toContain('Voc. — кличний');
  });
});

describe('stripStress', () => {
  it('removes every U+0301 and nothing else', () => {
    expect(stripStress('говори́ть')).toBe('говорить');
    expect(stripStress('бу́ду говори́ть / ска́жу')).toBe('буду говорить / скажу');
    expect(stripStress('ёж')).toBe('ёж');
    expect(STRESS).toBe('́');
  });
});

describe('validateProfile (§5.2) — the four minimal fixtures pass Zod + the validator', () => {
  for (const [name, build] of [
    ['verb', verbProfile],
    ['noun', nounProfile],
    ['adj', adjProfile],
    ['phrase', phraseProfile],
  ] as const) {
    it(`${name} fixture is valid`, () => {
      const parsed = WordProfileSchema.safeParse(build());
      expect(parsed.success).toBe(true);
      const result = validateProfile(build());
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

describe('validateProfile (§5.2) — one issue per rule', () => {
  it('rule 2: wrong column count names the row', () => {
    const p = verbProfile();
    p.sections[0]!.grid!.cells[4] = [cell('говори́те'), cell('бу́дете говори́ть'), cell('x')];
    const r = validateProfile(p);
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual('sections[0].grid.cells[4]: expected 2 columns, got 3');
  });

  it('rule 2: wrong row count names the section', () => {
    const p = nounProfile();
    p.sections[0]!.grid!.cells.pop();
    expect(validateProfile(p).issues).toContainEqual(
      'sections[0].grid.cells: expected 6 rows (one per rowLabel), got 5',
    );
  });

  it('rule 2: fixed row labels must be verbatim (trim-tolerant)', () => {
    const p = verbProfile();
    p.sections[0]!.grid!.rowLabels[2] = 'он/она/оно';
    const r = validateProfile(p);
    expect(r.issues.some((i) => i.startsWith('sections[0].grid.rowLabels: must be exactly'))).toBe(
      true,
    );
    const ok = verbProfile();
    ok.sections[0]!.grid!.rowLabels[0] = ' я ';
    expect(validateProfile(ok).ok).toBe(true);
  });

  it('rule 1: a Latin letter in a form is an issue; a digit too', () => {
    const p = verbProfile();
    p.sections[0]!.grid!.cells[0]![0] = { ru: 'govorю́', plain: 'govorю' };
    expect(
      validateProfile(p).issues.some((i) => i.includes('sections[0].grid.cells[0][0].plain')),
    ).toBe(true);
    const q = nounProfile();
    q.sections[1]!.rows![0] = row('окно́2', 'x');
    expect(validateProfile(q).issues.some((i) => i.includes('sections[1].rows[0].plain'))).toBe(
      true,
    );
  });

  it('rule 1: plain must equal ru with stress removed', () => {
    const p = verbProfile();
    p.headword = { ru: 'говори́ть', plain: 'говорит' };
    expect(validateProfile(p).issues).toContainEqual(
      'headword.plain: must equal ru with every U+0301 removed (got "говорит")',
    );
  });

  it('rule 1: non-NFC forms are issues; example.ru must be NFC but may hold digits/Latin', () => {
    const p = verbProfile();
    const nfd = 'й'.normalize('NFD'); // и + U+0306
    expect(nfd).not.toBe('й');
    p.sections[4]!.rows![0] = { ru: `говоря́${nfd}`, plain: `говоря${nfd}`, gloss: 'x' };
    const r = validateProfile(p);
    expect(r.issues).toContainEqual('sections[4].rows[0].ru: not NFC-normalized');
    expect(r.issues).toContainEqual('sections[4].rows[0].plain: not NFC-normalized');

    const q = verbProfile();
    q.sections[6]!.rows![0]!.example = { ru: 'В 19:30 Иван говорил с Anna по Zoom.', en: 'x' };
    expect(validateProfile(q).ok).toBe(true);
    q.sections[6]!.rows![0]!.example = { ru: `Ива${nfd}н`, en: 'x' };
    expect(validateProfile(q).issues).toContainEqual(
      'sections[6].rows[0].example.ru: not NFC-normalized',
    );
  });

  it('rule 3: a missing required section is named with the POS', () => {
    const p = adjProfile();
    p.sections.splice(1, 1); // drop adj-short
    expect(validateProfile(p).issues).toContainEqual(
      'sections: required section "adj-short" for pos "adj" is missing',
    );
  });

  it('rule 3: sections must follow catalog order; x- sections go last', () => {
    const p = nounProfile();
    p.sections.reverse();
    expect(validateProfile(p).issues).toContainEqual(
      'sections[1].id: "noun-declension" is out of catalog order',
    );

    const q = nounProfile();
    q.sections.unshift({
      id: 'x-etymology',
      title: { en: 'Etymology', ru: 'Этимология' },
      layout: 'list',
      rows: [row('о́ко', 'eye (archaic)')],
    });
    const r = validateProfile(q);
    expect(r.issues).toContainEqual(
      'sections[1].id: catalog section "noun-declension" must come before every "x-" section',
    );
    // …and the same extra section at the END is fine.
    const ok = nounProfile();
    ok.sections.push(q.sections[0]!);
    expect(validateProfile(ok).ok).toBe(true);
  });

  it('rule 3: an unknown non-x id is rejected (Zod passes the shape, the catalog does not)', () => {
    const p = nounProfile();
    p.sections[1]!.id = 'noun-familly';
    expect(validateProfile(p).issues).toContainEqual(
      'sections[1].id: "noun-familly" is not a catalog id (extra sections must use an "x-" id)',
    );
  });

  it('rule 4: duplicate ids', () => {
    const p = nounProfile();
    p.sections.push({ ...nounProfile().sections[1]! });
    expect(validateProfile(p).issues).toContainEqual(
      'sections[2].id: duplicate section id "noun-family"',
    );
  });

  it('rule 4: grid layout with rows / list layout with grid / catalog layout mismatch', () => {
    const p = nounProfile();
    p.sections[0]!.rows = [row('окно́', 'x')];
    expect(validateProfile(p).issues).toContainEqual(
      'sections[0].rows: must be absent for layout "grid"',
    );
    const q = nounProfile();
    q.sections[1]!.grid = p.sections[0]!.grid;
    expect(validateProfile(q).issues).toContainEqual(
      'sections[1].grid: must be absent for layout "list"',
    );
    const s = nounProfile();
    s.sections[1] = {
      ...s.sections[1]!,
      layout: 'grid',
      grid: p.sections[0]!.grid,
      rows: undefined,
    };
    expect(validateProfile(s).issues).toContainEqual(
      'sections[1].layout: catalog section "noun-family" is a list section, got grid',
    );
  });

  it('rule 5: an empty list section is an issue; verb-family > 14 rows is an issue', () => {
    const p = nounProfile();
    p.sections[1]!.rows = [];
    expect(validateProfile(p).issues).toContainEqual(
      'sections[1].rows: a list section needs at least one row — omit the section instead (and explain in overview.notes)',
    );
    const v = verbProfile();
    v.sections[5]!.rows = Array.from({ length: 15 }, (_, i) => row('сказа́ть', `g${i}`));
    expect(validateProfile(v).issues).toContainEqual(
      'sections[5].rows: verb-family may have at most 14 rows, got 15',
    );
    v.sections[5]!.rows = v.sections[5]!.rows.slice(0, 14);
    expect(validateProfile(v).ok).toBe(true);
  });

  it('rule 6 (soft): a stress-less polysyllable warns without failing; ё and monosyllables do not', () => {
    const p = nounProfile();
    p.sections[1]!.rows = [row('окошко', 'little window'), row('ёж', 'x'), row('дом', 'x')];
    const r = validateProfile(p);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      'sections[1].rows[0].ru: "окошко" has 3 vowels but no stress mark',
    ]);
    // A half-stressed compound still warns on the bare token.
    const q = verbProfile();
    q.sections[0]!.grid!.cells[0]![1] = cell('бу́ду говорить');
    expect(validateProfile(q).warnings).toEqual([
      'sections[0].grid.cells[0][1].ru: "говорить" has 3 vowels but no stress mark',
    ]);
  });

  it('reports several issues at once (the correction turn quotes them all)', () => {
    const p = verbProfile();
    p.sections[0]!.grid!.cells[1] = [cell('говори́шь')];
    p.sections[4]!.rows![0] = { ru: 'govorya', plain: 'govorya', gloss: 'x' };
    const r = validateProfile(p);
    expect(r.issues).toHaveLength(2);
  });
});

describe('profileKeyFor (§5.4)', () => {
  it('word → lemmaNorm; phrase → normalized; lemma-less word → null', () => {
    expect(profileKeyFor({ kind: 'word', lemmaNorm: 'говорить', normalized: 'говорю' })).toEqual({
      lemmaNorm: 'говорить',
      kind: 'word',
    });
    expect(
      profileKeyFor({ kind: 'phrase', lemmaNorm: null, normalized: 'волосы встали дыбом' }),
    ).toEqual({ lemmaNorm: 'волосы встали дыбом', kind: 'phrase' });
    expect(profileKeyFor({ kind: 'word', lemmaNorm: null, normalized: 'чего-то' })).toBeNull();
  });
});
