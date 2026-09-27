import { describe, expect, it } from 'vitest';

import { parseHelpLine } from '@/features/ai/prompts/scenario-help';

import {
  detectMetaIntent,
  englishQuery,
  englishTail,
  findGlossaryByEnglish,
  findGlossaryByRu,
  findGlossaryByTranslit,
  findPlayedToken,
  META_TRIGGER_THRESHOLD,
  META_TRIGGERS,
  resolveExplain,
  resolveHowToSay,
  similarity,
  SLOWER_MOUTH_SCALE,
  SLOWER_RATE,
  TRANSLIT_MIN_SIMILARITY,
  type GlossaryLookupEntry,
} from '../meta-intents';

/** Meta-intents (T60, SPEAKING_SCENARIOS §6) + Appendix B garble seeds. */

describe('detectMetaIntent — triggers ± noise', () => {
  it.each([
    ['что значит связь', 'explain', 'связь'],
    ['Что значит «связь»?', 'explain', 'связь'],
    ['что такое проверка', 'explain', 'проверка'],
    ['что означает слышите', 'explain', 'слышите'],
    ['я не понимаю слово дела', 'explain', 'дела'],
    ['не понял слово зовут', 'explain', 'зовут'],
    ['как сказать хеллоу', 'howtosay', 'хеллоу'],
    ['как по-русски гуд', 'howtosay', 'гуд'],
    ['как будет по-русски конекшн', 'howtosay', 'конекшн'],
    ['как это сказать глэд', 'howtosay', 'глэд'],
    ['повтори', 'repeat', ''],
    ['повторите пожалуйста', 'repeat', ''],
    ['ещё раз', 'repeat', ''],
    ['что', 'repeat', ''],
    ['а', 'repeat', ''],
    ['помедленнее', 'slower', ''],
    ['медленнее пожалуйста', 'slower', ''],
    ['не так быстро', 'slower', ''],
    ['я не понимаю', 'dont-understand', ''],
    ['не понимаю', 'dont-understand', ''],
    ['я не понял', 'dont-understand', ''],
    ['я не поняла', 'dont-understand', ''],
  ])('«%s» ⇒ %s, query «%s»', (said, intent, query) => {
    const d = detectMetaIntent(said);
    expect(d?.intent).toBe(intent);
    expect(d?.query).toBe(query);
    expect(d!.score).toBeGreaterThanOrEqual(META_TRIGGER_THRESHOLD);
  });

  it('leading fillers are skipped («ну, пожалуйста, повтори», «извините, что значит…»)', () => {
    expect(detectMetaIntent('ну пожалуйста повтори')?.intent).toBe('repeat');
    expect(detectMetaIntent('извините, что значит связь')).toMatchObject({
      intent: 'explain',
      query: 'связь',
    });
  });

  it('ASR-shaped triggers still fire (edit tolerance inside the phrase)', () => {
    expect(detectMetaIntent('что значет связь')?.intent).toBe('explain');
    expect(detectMetaIntent('как сказат хеллоу')?.intent).toBe('howtosay');
    expect(detectMetaIntent('помедленее')?.intent).toBe('slower');
  });

  it('plain answers are NOT commands', () => {
    for (const said of [
      'меня зовут митч',
      'хорошо спасибо',
      'я из америки',
      'я люблю читать',
      'плохо, я устал',
      'да',
      'нет',
      'пять лет',
    ]) {
      expect(detectMetaIntent(said), said).toBeNull();
    }
  });

  it('one-token «что»/«а» must be the whole transcript — «что ты хочешь» is an answer', () => {
    expect(detectMetaIntent('что')?.intent).toBe('repeat');
    expect(detectMetaIntent('что ты хочешь')).toBeNull();
    expect(detectMetaIntent('а я не знаю')).toBeNull();
    expect(detectMetaIntent('а')?.intent).toBe('repeat');
  });

  it('a «что значит» tail inside an answer does not fire (head-anchored)', () => {
    expect(detectMetaIntent('я знаю что значит связь')).toBeNull();
  });

  it('the longer trigger wins: «я не понимаю слово X» is explain, «я не понимаю» + noise stays dont-understand', () => {
    expect(detectMetaIntent('я не понимаю слово связь')).toMatchObject({
      intent: 'explain',
      query: 'связь',
    });
    expect(detectMetaIntent('я не понимаю ничего')).toMatchObject({
      intent: 'dont-understand',
      query: '',
    });
  });

  it('explain with no query is still explain (resolver answers none)', () => {
    expect(detectMetaIntent('что значит')).toMatchObject({ intent: 'explain', query: '' });
  });

  it('uk has an empty table and detects nothing', () => {
    expect(META_TRIGGERS.uk).toEqual([]);
    expect(detectMetaIntent('повтори', 'uk')).toBeNull();
  });

  it('empty transcript ⇒ null', () => {
    expect(detectMetaIntent('')).toBeNull();
  });

  it('records the slower rate + mouth scale', () => {
    expect(SLOWER_RATE).toBe(0.8);
    expect(SLOWER_MOUTH_SCALE).toBe(1.25);
  });
});

// The fixture pack's glossary (a1-scenario-fixture, 15 entries — the pipeline's translit lists).
const FIXTURE_GLOSSARY: GlossaryLookupEntry[] = [
  {
    id: 'gl-check',
    ru: 'проверка',
    en: 'check',
    forms: ['проверка', 'проверк*'],
    translit: ['чек', 'чик', 'кек', 'кик'],
  },
  {
    id: 'gl-connection',
    ru: 'связь',
    en: 'connection',
    forms: ['связь', 'связи', 'связ*'],
    translit: [
      'конекшн',
      'канекшен',
      'конекшен',
      'коникшн',
      'коникшен',
      'канекшн',
      'каникшн',
      'каникшен',
    ],
  },
  {
    id: 'gl-to-hear',
    ru: 'слышать',
    en: 'to hear',
    forms: ['слышать', 'слыш*', 'расслыш*'],
    translit: ['хир', 'то хир', 'то хэр', 'то хер', 'та хир', 'та хэр', 'та хер'],
  },
  {
    id: 'gl-name',
    ru: 'зовут',
    en: 'name',
    forms: ['зовут', 'звать', 'имя'],
    translit: ['нэйм', 'нейм'],
  },
  {
    id: 'gl-things',
    ru: 'дела',
    en: 'things',
    forms: ['дела', 'дело'],
    translit: ['сингз', 'тингс', 'тайнгс', 'сингс', 'сайнгс', 'фингс', 'файнгс', 'зингс', 'зайнгс'],
  },
  { id: 'gl-good', ru: 'хорошо', en: 'good', forms: ['хорошо', 'хорош*'], translit: ['гуд'] },
  {
    id: 'gl-glad',
    ru: 'рад',
    en: 'glad',
    forms: ['рад', 'рада', 'рады'],
    translit: ['глэд', 'глад'],
  },
  {
    id: 'gl-to-understand',
    ru: 'понимать',
    en: 'to understand',
    forms: ['понимать', 'понима*', 'поня*'],
    translit: ['андерстэнд', 'андэстэнд', 'то ундерстанд', 'то андерстанд'],
  },
  {
    id: 'gl-to-rest',
    ru: 'отдохнуть',
    en: 'to rest',
    forms: ['отдохнуть', 'отдохн*', 'отдыха*'],
    translit: ['рест', 'то рест', 'то рист', 'та рест', 'та рист'],
  },
  {
    id: 'gl-clear',
    ru: 'ясно',
    en: 'clear',
    forms: ['ясно', 'ясн*'],
    translit: ['клир', 'клиа', 'клэр', 'клер'],
  },
  {
    id: 'gl-to-say',
    ru: 'сказать',
    en: 'to say',
    forms: ['сказать', 'скажи*', 'сказ*'],
    translit: ['сэй', 'сей', 'то сэй', 'та сэй'],
  },
  {
    id: 'gl-for-example',
    ru: 'например',
    en: 'for example',
    forms: ['например'],
    translit: ['фор экзампл', 'экзампл', 'фор эксампл'],
  },
  {
    id: 'gl-word',
    ru: 'слово',
    en: 'word',
    forms: ['слово', 'слова', 'слов*'],
    translit: ['уорд', 'ворд'],
  },
  {
    id: 'gl-to-know',
    ru: 'знать',
    en: 'to know',
    forms: ['знать', 'зна*'],
    translit: ['ноу', 'то нау', 'то ноу', 'та нау', 'та ноу'],
  },
  { id: 'gl-bad', ru: 'плохо', en: 'bad', forms: ['плохо', 'плох*'], translit: ['бэд', 'бад'] },
];

describe('findGlossaryByRu («что значит X»)', () => {
  it('headword, forms, globs, ё/е and ASR edits', () => {
    expect(findGlossaryByRu(['связь'], FIXTURE_GLOSSARY)?.id).toBe('gl-connection');
    expect(findGlossaryByRu(['связи'], FIXTURE_GLOSSARY)?.id).toBe('gl-connection');
    expect(findGlossaryByRu(['слышите'], FIXTURE_GLOSSARY)?.id).toBe('gl-to-hear');
    expect(findGlossaryByRu(['расслышал'], FIXTURE_GLOSSARY)?.id).toBe('gl-to-hear');
    expect(findGlossaryByRu(['имя'], FIXTURE_GLOSSARY)?.id).toBe('gl-name');
    expect(findGlossaryByRu(['проверко'], FIXTURE_GLOSSARY)?.id).toBe('gl-check'); // 1 edit
    expect(findGlossaryByRu(['слово', 'связь'], FIXTURE_GLOSSARY)?.id).toBe('gl-word'); // first query token wins
    expect(findGlossaryByRu(['эфир'], FIXTURE_GLOSSARY)).toBeNull();
  });
});

describe('findPlayedToken (host lines already heard)', () => {
  const played = [
    { text: 'Проверка', lemma: 'проверка', translation: 'check' },
    { text: 'Отлично', lemma: 'отлично', translation: 'great' },
    { text: 'эфира', lemma: 'эфир', translation: 'air' },
    { text: 'До', lemma: 'до', translation: null },
  ];
  it('matches surface or lemma with edits; skips untranslated tokens', () => {
    expect(findPlayedToken(['отлично'], played)?.translation).toBe('great');
    expect(findPlayedToken(['эфир'], played)?.translation).toBe('air');
    expect(findPlayedToken(['эфире'], played)?.translation).toBe('air');
    expect(findPlayedToken(['до'], played)).toBeNull();
    expect(findPlayedToken(['зеркало'], played)).toBeNull();
  });
});

describe('findGlossaryByTranslit («как сказать X»)', () => {
  it('exact garble, tolerant garble, noise-prefixed garble', () => {
    expect(findGlossaryByTranslit(['конекшн'], FIXTURE_GLOSSARY)?.entry.id).toBe('gl-connection');
    expect(findGlossaryByTranslit(['канекшин'], FIXTURE_GLOSSARY)?.entry.id).toBe('gl-connection');
    expect(findGlossaryByTranslit(['ну', 'гуд'], FIXTURE_GLOSSARY)?.entry.id).toBe('gl-good');
    expect(findGlossaryByTranslit(['то', 'хир'], FIXTURE_GLOSSARY)?.entry.id).toBe('gl-to-hear');
    expect(findGlossaryByTranslit(['андерстенд'], FIXTURE_GLOSSARY)?.entry.id).toBe(
      'gl-to-understand',
    );
    expect(findGlossaryByTranslit([], FIXTURE_GLOSSARY)).toBeNull();
    expect(findGlossaryByTranslit(['зеркало'], FIXTURE_GLOSSARY)).toBeNull();
  });

  it('similarity is symmetric 0–100 and the floor is recorded', () => {
    expect(similarity('гуд', 'гуд')).toBe(100);
    expect(similarity('конекшн', 'канекшн')).toBe(86);
    expect(TRANSLIT_MIN_SIMILARITY).toBe(70);
  });
});

/**
 * Appendix B seeds: each English word's expected Cyrillic candidates ARE
 * the glossary's translit lists (the pipeline's translit.ts produced ≥ 1 of
 * each in T56). Here the "garble" is a plausible ASR hearing of the FIRST
 * candidate — one edit or a dropped final consonant — and ≥ 25/30 must
 * resolve to their own entry.
 */
const APPENDIX_B: [string, string[]][] = [
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
const APPENDIX_B_GLOSSARY: GlossaryLookupEntry[] = APPENDIX_B.map(([en, translit]) => ({
  id: `b-${en}`,
  ru: en,
  en,
  forms: [en],
  translit,
}));
/** A plausible zipformer hearing: swap one vowel, or drop the final consonant of ≥ 5-char words. */
function garble(candidate: string, i: number): string {
  const vowels = 'аеиоуэы';
  const chars = [...candidate];
  if (i % 2 === 0) {
    const vi = chars.findIndex((c, k) => k > 0 && vowels.includes(c));
    if (vi > 0) chars[vi] = chars[vi] === 'а' ? 'о' : 'а';
    return chars.join('');
  }
  return chars.length >= 5 ? chars.slice(0, -1).join('') : chars.join('') + 'а';
}

describe('Appendix B garble → translit hits', () => {
  it('≥ 25 of the 30 seeds resolve to their own entry from a garbled first candidate', () => {
    const misses: string[] = [];
    APPENDIX_B.forEach(([en, cands], i) => {
      const heard = garble(cands[0]!, i);
      const hit = findGlossaryByTranslit([heard], APPENDIX_B_GLOSSARY);
      if (hit?.entry.id !== `b-${en}`)
        misses.push(`${en}: «${heard}» → ${hit?.entry.id ?? 'none'}`);
    });
    expect(misses.length, misses.join('\n')).toBeLessThanOrEqual(5);
  });

  it('every exact candidate resolves (30/30)', () => {
    for (const [en, cands] of APPENDIX_B) {
      for (const c of cands) {
        expect(findGlossaryByTranslit([c], APPENDIX_B_GLOSSARY)?.entry.id, `${en}: ${c}`).toBe(
          `b-${en}`,
        );
      }
    }
  });
});

describe('Whisper tail + English matching', () => {
  it('englishTail keeps the last 1–3 alphabetic tokens', () => {
    expect(englishTail('kak skazat wallet')).toEqual(['kak', 'skazat', 'wallet']);
    expect(englishTail('How do you say, wallet?')).toEqual(['you', 'say', 'wallet']);
    expect(englishQuery(['you', 'say', 'wallet'])).toEqual(['wallet']);
    expect(englishQuery(['to', 'say'])).toEqual(['to', 'say']);
    expect(englishTail('Как сказать stomach')).toEqual(['stomach']);
    expect(englishTail('')).toEqual([]);
  });

  it('findGlossaryByEnglish is tolerant and ignores function words', () => {
    expect(findGlossaryByEnglish(['how', 'to', 'say', 'wallet'], APPENDIX_B_GLOSSARY)?.id).toBe(
      'b-wallet',
    );
    expect(findGlossaryByEnglish(['wallets'], APPENDIX_B_GLOSSARY)?.id).toBe('b-wallet');
    expect(findGlossaryByEnglish(['hear'], FIXTURE_GLOSSARY)?.id).toBe('gl-to-hear');
    expect(findGlossaryByEnglish(['understand'], FIXTURE_GLOSSARY)?.id).toBe('gl-to-understand');
    expect(findGlossaryByEnglish(['to'], FIXTURE_GLOSSARY)).toBeNull();
    expect(findGlossaryByEnglish(['banana'], FIXTURE_GLOSSARY)).toBeNull();
  });
});

describe('resolveExplain', () => {
  const sid = (id: string) => `${id}:explain`;
  const played = [{ text: 'Отлично', lemma: 'отлично', translation: 'great' }];
  it('glossary clip first', async () => {
    const d = detectMetaIntent('что значит связь')!;
    const r = await resolveExplain(d, {
      glossary: FIXTURE_GLOSSARY,
      explainSentenceId: sid,
      played,
    });
    expect(r).toEqual({
      intent: 'explain',
      source: 'glossary',
      entryId: 'gl-connection',
      sentenceId: 'gl-connection:explain',
      ru: 'связь',
      en: 'connection',
    });
  });
  it('played host token ⇒ суфлёр gloss', async () => {
    const d = detectMetaIntent('что значит отлично')!;
    const r = await resolveExplain(d, {
      glossary: FIXTURE_GLOSSARY,
      explainSentenceId: sid,
      played,
    });
    expect(r).toEqual({ intent: 'explain', source: 'played', ru: 'отлично', en: 'great' });
  });
  it('online one-liner when nothing local; none when offline', async () => {
    const d = detectMetaIntent('что значит зеркало')!;
    const online = await resolveExplain(d, {
      glossary: FIXTURE_GLOSSARY,
      explainSentenceId: sid,
      played,
      online: async () => 'mirror',
    });
    expect(online).toMatchObject({ source: 'online', ru: 'зеркало', en: 'mirror' });
    const offline = await resolveExplain(d, {
      glossary: FIXTURE_GLOSSARY,
      explainSentenceId: sid,
      played,
    });
    expect(offline).toEqual({ intent: 'explain', source: 'none' });
    const failed = await resolveExplain(d, {
      glossary: FIXTURE_GLOSSARY,
      explainSentenceId: sid,
      played,
      online: async () => {
        throw new Error('x');
      },
    });
    expect(failed.source).toBe('none');
  });
  it('no query ⇒ none', async () => {
    const d = detectMetaIntent('что значит')!;
    expect(
      (await resolveExplain(d, { glossary: FIXTURE_GLOSSARY, explainSentenceId: sid, played }))
        .source,
    ).toBe('none');
  });
});

describe('resolveHowToSay', () => {
  const sid = (id: string) => `${id}:howtosay`;
  it('translit hit ⇒ glossary clip', async () => {
    const d = detectMetaIntent('как сказать конекшн')!;
    const r = await resolveHowToSay(d, { glossary: FIXTURE_GLOSSARY, howToSaySentenceId: sid });
    expect(r).toMatchObject({
      source: 'glossary',
      entryId: 'gl-connection',
      sentenceId: 'gl-connection:howtosay',
    });
  });
  it('translit miss ⇒ Whisper tail ⇒ en match', async () => {
    const d = detectMetaIntent('как сказать блаблабла')!;
    let asked = 0;
    const r = await resolveHowToSay(d, {
      glossary: FIXTURE_GLOSSARY,
      howToSaySentenceId: sid,
      whisper: async () => {
        asked++;
        return 'kak skazat to hear';
      },
    });
    expect(asked).toBe(1);
    expect(r).toMatchObject({ source: 'whisper', entryId: 'gl-to-hear' });
  });
  it('Whisper misses ⇒ online with the ENGLISH tail; no Whisper ⇒ online with the garble', async () => {
    const d = detectMetaIntent('как сказать зеркало')!;
    const queries: string[] = [];
    const r = await resolveHowToSay(d, {
      glossary: FIXTURE_GLOSSARY,
      howToSaySentenceId: sid,
      whisper: async () => 'how to say mirror',
      online: async (q) => {
        queries.push(q);
        return 'зеркало';
      },
    });
    expect(r).toEqual({ intent: 'howtosay', source: 'online', ru: 'зеркало' });
    expect(queries).toEqual(['mirror']);
    const noWhisper = await resolveHowToSay(d, {
      glossary: FIXTURE_GLOSSARY,
      howToSaySentenceId: sid,
      online: async (q) => {
        queries.push(q);
        return null;
      },
    });
    expect(noWhisper).toEqual({ intent: 'howtosay', source: 'none' });
    expect(queries[1]).toBe('зеркало');
  });
  it('everything absent ⇒ none (the dont-know nudge + lifeline)', async () => {
    const d = detectMetaIntent('как сказать зеркало')!;
    expect(
      await resolveHowToSay(d, { glossary: FIXTURE_GLOSSARY, howToSaySentenceId: sid }),
    ).toEqual({ intent: 'howtosay', source: 'none' });
  });
});

describe('parseHelpLine', () => {
  it('first line, trimmed, unquoted, bounded; unknown ⇒ null', () => {
    expect(parseHelpLine('  «зеркало»\nmore')).toBe('зеркало');
    expect(parseHelpLine('unknown')).toBeNull();
    expect(parseHelpLine('Unknown\n')).toBeNull();
    expect(parseHelpLine('')).toBeNull();
    expect(parseHelpLine('x'.repeat(200))).toBeNull();
  });
});
