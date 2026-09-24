import { CASES, GENDERS, PERSONS } from '../profile-core';
import type { ProfileCell, ProfileRow, ProfileSection, WordProfile } from '../profile-schema';

/**
 * Minimal, structurally valid profiles for the T52 tests (small on purpose —
 * the captured fixtures in features/ai/__tests__/__fixtures__ are the real
 * ones). Each builder returns a fresh object so tests can mutate freely.
 */

export function cell(ru: string, extra: Partial<NonNullable<ProfileCell>> = {}): ProfileCell {
  return { ru, plain: ru.replaceAll('́', ''), ...extra };
}

export function row(ru: string, gloss = 'gloss', extra: Partial<ProfileRow> = {}): ProfileRow {
  return { ru, plain: ru.replaceAll('́', ''), gloss, ...extra };
}

function grid(
  id: string,
  title: { en: string; ru: string },
  rowLabels: readonly string[],
  colLabels: readonly string[],
  fill: (r: number, c: number) => ProfileCell,
): ProfileSection {
  return {
    id,
    title,
    layout: 'grid',
    grid: {
      rowLabels: [...rowLabels],
      colLabels: [...colLabels],
      cells: rowLabels.map((_, r) => colLabels.map((__, c) => fill(r, c))),
    },
  };
}

function list(id: string, title: { en: string; ru: string }, rows: ProfileRow[]): ProfileSection {
  return { id, title, layout: 'list', rows };
}

export function verbProfile(): WordProfile {
  return {
    v: 1,
    language: 'ru',
    kind: 'word',
    pos: 'verb',
    headword: { ru: 'говори́ть', plain: 'говорить' },
    overview: {
      gloss: 'to speak, to talk',
      facts: [{ label: 'aspect', value: 'imperfective' }],
      notes: [],
    },
    sections: [
      grid(
        'verb-nonpast',
        { en: 'Present & future', ru: 'Настоящее и будущее' },
        PERSONS,
        ['Present', 'Future'],
        (r, c) => (c === 0 ? cell('говорю́') : cell('бу́ду говори́ть')),
      ),
      grid(
        'verb-past',
        { en: 'Past & conditional', ru: 'Прошедшее и условное' },
        GENDERS,
        ['Past', 'Conditional (бы)'],
        () => cell('говори́л'),
      ),
      grid(
        'verb-imperative',
        { en: 'Imperative', ru: 'Повелительное' },
        ['ты', 'вы'],
        ['Imperative'],
        () => cell('говори́'),
      ),
      grid(
        'verb-participles',
        { en: 'Participles', ru: 'Причастия' },
        [
          'Present active',
          'Past active',
          'Present passive',
          'Past passive',
          'Past passive short (m / f / n / pl)',
        ],
        ['Form'],
        (r) => (r === 3 || r === 4 ? null : cell('говоря́щий')),
      ),
      list('verb-gerunds', { en: 'Verbal adverbs', ru: 'Деепричастия' }, [
        row('говоря́', 'while speaking'),
      ]),
      list('verb-family', { en: 'Aspect pair & word family', ru: 'Видовая пара и семья слова' }, [
        row('сказа́ть', 'to say (pf.)', { tags: ['partner', 'pf'] }),
        row('поговори́ть', 'to have a talk', { tags: ['pf', 'prefix:по-'] }),
      ]),
      list(
        'verb-government',
        { en: 'Government & collocations', ru: 'Управление и сочетаемость' },
        [
          row('говори́ть с ке́м-либо', 'to talk with someone — с + instr.', {
            example: {
              ru: 'Я говорю́ с ма́мой по телефо́ну.',
              en: 'I am talking with mum on the phone.',
            },
          }),
        ],
      ),
    ],
  };
}

export function nounProfile(): WordProfile {
  return {
    v: 1,
    language: 'ru',
    kind: 'word',
    pos: 'noun',
    headword: { ru: 'окно́', plain: 'окно' },
    overview: { gloss: 'window', facts: [{ label: 'gender', value: 'neuter' }], notes: [] },
    sections: [
      grid(
        'noun-declension',
        { en: 'Declension', ru: 'Склонение' },
        CASES.ru,
        ['Singular', 'Plural'],
        (r, c) => (c === 0 ? cell('окно́') : cell('о́кна')),
      ),
      list('noun-family', { en: 'Word family', ru: 'Семья слова' }, [
        row('око́шко', 'little window', { tags: ['dim'] }),
      ]),
    ],
  };
}

export function adjProfile(): WordProfile {
  return {
    v: 1,
    language: 'ru',
    kind: 'word',
    pos: 'adj',
    headword: { ru: 'стра́шный', plain: 'страшный' },
    overview: { gloss: 'scary, terrible', facts: [], notes: [] },
    sections: [
      grid(
        'adj-long',
        { en: 'Long-form declension', ru: 'Полная форма' },
        CASES.ru,
        ['Masc.', 'Fem.', 'Neut.', 'Plural'],
        () => cell('стра́шный'),
      ),
      list('adj-short', { en: 'Short forms', ru: 'Краткие формы' }, [row('стра́шен', 'm.')]),
      list('adj-comparison', { en: 'Comparative & superlative', ru: 'Степени сравнения' }, [
        row('страшне́е', 'scarier'),
      ]),
    ],
  };
}

export function phraseProfile(): WordProfile {
  return {
    v: 1,
    language: 'ru',
    kind: 'phrase',
    pos: 'phrase',
    headword: { ru: 'во́лосы вста́ли ды́бом', plain: 'волосы встали дыбом' },
    overview: { gloss: "one's hair stood on end", facts: [], notes: [] },
    sections: [
      list('phrase-structure', { en: 'Word by word', ru: 'Разбор по словам' }, [
        row('во́лосы', 'nom. pl. of во́лос'),
      ]),
      list('phrase-usage', { en: 'Usage & register', ru: 'Употребление и стиль' }, [
        row('у меня́ во́лосы вста́ли ды́бом', 'my hair stood on end', {
          example: {
            ru: 'Когда я услышал шаги, у меня волосы встали дыбом.',
            en: 'When I heard the steps my hair stood on end.',
          },
        }),
      ]),
    ],
  };
}
