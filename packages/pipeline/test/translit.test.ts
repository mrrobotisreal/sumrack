import { describe, expect, it } from 'vitest';
import { TRANSLIT_MAX_CANDIDATES, mergeTranslit, transliterate } from '../src/translit.ts';

/**
 * The 30 Appendix B seeds of `docs/design/SCENARIO_SCRIPTS_BATCH_1.md`
 * (workspace root), copied verbatim: each English word must yield AT LEAST
 * ONE of its expected Cyrillic candidates. The candidates are what the
 * Russian zipformer tends to emit for English; the T59 benchmark refines them.
 */
const SEEDS: readonly [en: string, expected: readonly string[]][] = [
  ['stomach', ['стомак', 'стомэк']],
  ['headache', ['хэдэйк', 'хедейк']],
  ['fever', ['фивер', 'фива']],
  ['throat', ['троут', 'фроут', 'срот']],
  ['wallet', ['уолет', 'валет', 'воллет']],
  ['passport', ['паспорт', 'пэспорт']],
  ['receipt', ['ресит', 'рисит']],
  ['withdraw', ['уиздро', 'визро', 'видро']],
  ['exchange', ['эксчейндж', 'иксчейндж']],
  ['account', ['акаунт', 'эккаунт']],
  ['diesel', ['дизел', 'дизль']],
  ['engine', ['энджин', 'инджин']],
  ['tire', ['тайр', 'тайер']],
  ['bridge', ['бридж']],
  ['church', ['чёрч', 'чорч']],
  ['hotel', ['хотел', 'хоутел']],
  ['police', ['полис', 'палис']],
  ['witness', ['уитнес', 'витнес']],
  ['hoodie', ['худи']],
  ['beard', ['бирд', 'биард']],
  ['glasses', ['гласес', 'гласиз']],
  ['matches', ['мэтчез', 'матчес']],
  ['lighter', ['лайтер']],
  ['shift', ['шифт']],
  ['boss', ['бос', 'босс']],
  ['nightmare', ['найтмэр', 'найтмеа']],
  ['whisper', ['уиспер', 'виспер']],
  ['basement', ['бэйсмент', 'бейсмент']],
  ['guest', ['гест']],
  ['microphone', ['майкрофон', 'микрофон']],
];

describe('translit — Appendix B seeds', () => {
  it('has all 30 seeds', () => {
    expect(SEEDS).toHaveLength(30);
  });

  for (const [en, expected] of SEEDS) {
    it(`${en} → one of ${expected.join(' / ')}`, () => {
      const got = transliterate(en);
      const hit = expected.filter((e) => got.includes(e));
      expect(hit, `got: ${got.join(', ')}`).not.toHaveLength(0);
    });
  }
});

describe('translit — mechanics', () => {
  it('is deterministic, primary-first, deduped, NFC and capped', () => {
    const a = transliterate('exchange');
    expect(a).toEqual(transliterate('Exchange'));
    expect(new Set(a).size).toBe(a.length);
    expect(a.length).toBeLessThanOrEqual(TRANSLIT_MAX_CANDIDATES);
    for (const c of a) expect(c).toBe(c.normalize('NFC'));
    expect(a[0]).toBe('эксчэйндж');
    expect(a).toContain('эксчейндж');
  });

  it('handles phrases word by word and strips non-letters', () => {
    const got = transliterate('gas station!');
    expect(got[0]!.split(' ')).toHaveLength(2);
    expect(got[0]).toMatch(/^гас ст/);
    expect(transliterate('')).toEqual([]);
    expect(transliterate('123')).toEqual([]);
  });

  it('drops the silent final e and keeps a pronounced one', () => {
    expect(transliterate('hotel')).toContain('хотел');
    expect(transliterate('police')).toContain('полис');
    expect(transliterate('guest')).toContain('гест');
  });

  it('mergeTranslit puts hand extras first, then generated, deduped case-insensitively', () => {
    expect(mergeTranslit(['стомак', 'стомэк'], ['Стомик', 'стомак ', ''])).toEqual([
      'стомик',
      'стомак',
      'стомэк',
    ]);
  });
});
