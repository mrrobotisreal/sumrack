import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LemmaListSchema, parsePack, referenceLemmaKey, safeParsePack } from '../src';

const fixture = () =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'fixtures', 'packs', 'core-lemmas-fixture', 'pack.json'),
      'utf8',
    ),
  ) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function issues(pack: unknown): string[] {
  const r = safeParsePack(pack);
  return r.success ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe('reference pack (T38)', () => {
  it('the fixture validates: stories-free, two lists', () => {
    const pack = parsePack(fixture());
    expect(pack.type).toBe('reference');
    expect(pack.stories).toHaveLength(0);
    expect(pack.lemmaLists?.map((l) => l.id)).toEqual(['core-a1', 'core-a2']);
  });

  it('a reference pack needs at least one list', () => {
    const p = fixture();
    delete p.lemmaLists;
    expect(issues(p).join('\n')).toContain('must contain at least one lemma list');
  });

  it('list ids are unique within the pack', () => {
    const p = fixture();
    p.lemmaLists[1].id = 'core-a1';
    expect(issues(p).join('\n')).toContain('duplicate lemma list id "core-a1"');
  });

  it('rejects a duplicate folded lemma + pos inside one list (ё/е fold)', () => {
    const p = fixture();
    p.lemmaLists[0].lemmas.push({ lemma: 'еще', pos: 'adv' });
    expect(issues(p).join('\n')).toContain('duplicate lemma "еще" (adv)');
  });

  it('the same lemma under another POS is allowed', () => {
    const r = LemmaListSchema.safeParse({
      id: 'x',
      level: 'A1',
      title: { ru: 'x', en: 'x' },
      lemmas: [
        { lemma: 'что', pos: 'pron' },
        { lemma: 'что', pos: 'conj' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-Cyrillic, capitalised, spaced or NFD lemmas', () => {
    for (const bad of ['Дом', 'dom', 'два слова', 'й']) {
      const p = fixture();
      p.lemmaLists[0].lemmas[0].lemma = bad;
      expect(issues(p).length, bad).toBeGreaterThan(0);
    }
  });

  it('referenceLemmaKey folds ё and case like the app normalizeRu', () => {
    expect(referenceLemmaKey('Ещё')).toBe('еще');
    expect(referenceLemmaKey('чёрный')).toBe('черный');
  });

  it('lemmaLists on a non-reference pack are allowed (additive section)', () => {
    const p = fixture();
    p.type = 'prompts';
    p.prompts = [{ id: 'p1', level: 'A1', prompt: { ru: 'Привет', en: 'Hi' } }];
    expect(issues(p)).toEqual([]);
  });
});
