import { describe, expect, it } from 'vitest';

import {
  cardinal,
  formatAge,
  formatClock,
  formatDate,
  formatPrice,
  formatYear,
  ordinal,
  ordinalGenitive,
  pluralForm,
} from '@/lib/ru-numbers';

/**
 * T34 reference corpus — written BY HAND from standard Russian grammar (not
 * generated from the implementation), reviewed in-session against a
 * reference table. The ticket's reputation lives here: the 1 / 2–4 / 5+
 * plural machinery, the 11–14 exception, gender agreement on 1 and 2, and
 * every formatter the numbers drill speaks.
 */

describe('cardinal — masculine (default)', () => {
  const table: [number, string][] = [
    [0, 'ноль'],
    [1, 'один'],
    [2, 'два'],
    [3, 'три'],
    [4, 'четыре'],
    [5, 'пять'],
    [9, 'девять'],
    [10, 'десять'],
    [11, 'одиннадцать'],
    [12, 'двенадцать'],
    [14, 'четырнадцать'],
    [15, 'пятнадцать'],
    [19, 'девятнадцать'],
    [20, 'двадцать'],
    [21, 'двадцать один'],
    [22, 'двадцать два'],
    [25, 'двадцать пять'],
    [40, 'сорок'],
    [44, 'сорок четыре'],
    [90, 'девяносто'],
    [99, 'девяносто девять'],
    [100, 'сто'],
    [101, 'сто один'],
    [111, 'сто одиннадцать'],
    [200, 'двести'],
    [300, 'триста'],
    [400, 'четыреста'],
    [512, 'пятьсот двенадцать'],
    [999, 'девятьсот девяносто девять'],
    [1000, 'тысяча'],
    [1001, 'тысяча один'],
    [1500, 'тысяча пятьсот'],
    [2000, 'две тысячи'],
    [2026, 'две тысячи двадцать шесть'],
    [3004, 'три тысячи четыре'],
    [4000, 'четыре тысячи'],
    [5000, 'пять тысяч'],
    [11000, 'одиннадцать тысяч'],
    [12345, 'двенадцать тысяч триста сорок пять'],
    [14000, 'четырнадцать тысяч'],
    [21000, 'двадцать одна тысяча'],
    [22000, 'двадцать две тысячи'],
    [25000, 'двадцать пять тысяч'],
    [100000, 'сто тысяч'],
    [101000, 'сто одна тысяча'],
    [111111, 'сто одиннадцать тысяч сто одиннадцать'],
    [999999, 'девятьсот девяносто девять тысяч девятьсот девяносто девять'],
    [1000000, 'миллион'],
    [2000000, 'два миллиона'],
    [5000000, 'пять миллионов'],
    [21000000, 'двадцать один миллион'],
    [2001001, 'два миллиона одна тысяча один'],
  ];
  it.each(table)('%i → %s', (n, words) => {
    expect(cardinal(n)).toBe(words);
  });
});

describe('cardinal — gender agreement on 1 and 2', () => {
  const table: [number, 'm' | 'f' | 'n', string][] = [
    [1, 'f', 'одна'],
    [1, 'n', 'одно'],
    [2, 'f', 'две'],
    [2, 'n', 'два'],
    [21, 'f', 'двадцать одна'],
    [22, 'f', 'двадцать две'],
    [31, 'n', 'тридцать одно'],
    [12, 'f', 'двенадцать'],
    [1001, 'f', 'тысяча одна'],
    [5, 'f', 'пять'],
  ];
  it.each(table)('%i (%s) → %s', (n, g, words) => {
    expect(cardinal(n, g)).toBe(words);
  });
});

describe('pluralForm — 1 / 2–4 / 5+ with the 11–14 exception', () => {
  const forms = ['год', 'года', 'лет'] as const;
  const table: [number, string][] = [
    [0, 'лет'],
    [1, 'год'],
    [2, 'года'],
    [4, 'года'],
    [5, 'лет'],
    [11, 'лет'],
    [12, 'лет'],
    [13, 'лет'],
    [14, 'лет'],
    [15, 'лет'],
    [21, 'год'],
    [22, 'года'],
    [25, 'лет'],
    [101, 'год'],
    [111, 'лет'],
    [112, 'лет'],
    [1004, 'года'],
    [1011, 'лет'],
  ];
  it.each(table)('%i → %s', (n, form) => {
    expect(pluralForm(n, forms)).toBe(form);
  });
});

describe('formatAge', () => {
  const table: [number, string][] = [
    [1, 'один год'],
    [2, 'два года'],
    [3, 'три года'],
    [5, 'пять лет'],
    [11, 'одиннадцать лет'],
    [14, 'четырнадцать лет'],
    [21, 'двадцать один год'],
    [22, 'двадцать два года'],
    [25, 'двадцать пять лет'],
    [36, 'тридцать шесть лет'],
    [44, 'сорок четыре года'],
    [91, 'девяносто один год'],
    [100, 'сто лет'],
    [101, 'сто один год'],
  ];
  it.each(table)('%i → %s', (n, words) => {
    expect(formatAge(n)).toBe(words);
  });
});

describe('formatPrice — roubles, kopecks, hryvnias', () => {
  const table: [number, number, 'rub' | 'uah', string][] = [
    [1, 0, 'rub', 'один рубль'],
    [2, 0, 'rub', 'два рубля'],
    [5, 0, 'rub', 'пять рублей'],
    [11, 0, 'rub', 'одиннадцать рублей'],
    [12, 0, 'rub', 'двенадцать рублей'],
    [21, 0, 'rub', 'двадцать один рубль'],
    [23, 0, 'rub', 'двадцать три рубля'],
    [100, 0, 'rub', 'сто рублей'],
    [125, 0, 'rub', 'сто двадцать пять рублей'],
    [1000, 0, 'rub', 'тысяча рублей'],
    [1001, 0, 'rub', 'тысяча один рубль'],
    [12, 50, 'rub', 'двенадцать рублей пятьдесят копеек'],
    [3, 21, 'rub', 'три рубля двадцать одна копейка'],
    [7, 2, 'rub', 'семь рублей две копейки'],
    [0, 1, 'rub', 'одна копейка'],
    [0, 0, 'rub', 'ноль рублей'],
    [1, 0, 'uah', 'одна гривна'],
    [2, 0, 'uah', 'две гривны'],
    [5, 0, 'uah', 'пять гривен'],
    [21, 0, 'uah', 'двадцать одна гривна'],
    [42, 0, 'uah', 'сорок две гривны'],
    [14, 0, 'uah', 'четырнадцать гривен'],
  ];
  it.each(table)('%i.%i %s → %s', (whole, kop, cur, words) => {
    expect(formatPrice(whole, kop, cur)).toBe(words);
  });
});

describe('formatClock — digital reading (the drill default)', () => {
  const table: [number, number, string][] = [
    [14, 30, 'четырнадцать тридцать'],
    [7, 0, 'семь ноль-ноль'],
    [9, 5, 'девять ноль пять'],
    [0, 15, 'ноль пятнадцать'],
    [12, 45, 'двенадцать сорок пять'],
    [21, 21, 'двадцать один двадцать одна'],
    [22, 2, 'двадцать два ноль две'],
    [23, 59, 'двадцать три пятьдесят девять'],
    [1, 1, 'один ноль одна'],
  ];
  it.each(table)('%i:%i → %s', (h, m, words) => {
    expect(formatClock(h, m)).toBe(words);
  });
});

describe('formatClock — full reading', () => {
  const table: [number, number, string][] = [
    [14, 30, 'четырнадцать часов тридцать минут'],
    [1, 21, 'один час двадцать одна минута'],
    [2, 2, 'два часа две минуты'],
    [22, 0, 'двадцать два часа'],
    [11, 11, 'одиннадцать часов одиннадцать минут'],
    [21, 5, 'двадцать один час пять минут'],
    [3, 44, 'три часа сорок четыре минуты'],
  ];
  it.each(table)('%i:%i → %s', (h, m, words) => {
    expect(formatClock(h, m, 'full')).toBe(words);
  });
});

describe('ordinals', () => {
  const table: [number, 'm' | 'f' | 'n', string][] = [
    [1, 'm', 'первый'],
    [2, 'n', 'второе'],
    [3, 'm', 'третий'],
    [3, 'n', 'третье'],
    [3, 'f', 'третья'],
    [4, 'n', 'четвёртое'],
    [7, 'f', 'седьмая'],
    [8, 'n', 'восьмое'],
    [11, 'n', 'одиннадцатое'],
    [20, 'n', 'двадцатое'],
    [23, 'n', 'двадцать третье'],
    [31, 'n', 'тридцать первое'],
    [40, 'm', 'сороковой'],
    [100, 'm', 'сотый'],
    [1000, 'm', 'тысячный'],
  ];
  it.each(table)('%i (%s) → %s', (n, g, words) => {
    expect(ordinal(n, g)).toBe(words);
  });

  it('genitive ordinals (for «в … году»-style reuse)', () => {
    expect(ordinalGenitive(1987)).toBe('тысяча девятьсот восемьдесят седьмого');
    expect(ordinalGenitive(3)).toBe('третьего');
    expect(ordinalGenitive(2000)).toBe('двухтысячного');
  });
});

describe('formatDate — neuter ordinal + genitive month', () => {
  const table: [number, number, string][] = [
    [5, 3, 'пятое марта'],
    [1, 1, 'первое января'],
    [2, 2, 'второе февраля'],
    [3, 4, 'третье апреля'],
    [9, 5, 'девятое мая'],
    [12, 6, 'двенадцатое июня'],
    [13, 7, 'тринадцатое июля'],
    [24, 8, 'двадцать четвёртое августа'],
    [1, 9, 'первое сентября'],
    [30, 10, 'тридцатое октября'],
    [7, 11, 'седьмое ноября'],
    [31, 12, 'тридцать первое декабря'],
    [29, 2, 'двадцать девятое февраля'],
  ];
  it.each(table)('%i/%i → %s', (d, m, words) => {
    expect(formatDate(d, m)).toBe(words);
  });

  it('rejects impossible days', () => {
    expect(() => formatDate(31, 4)).toThrow(RangeError);
    expect(() => formatDate(30, 2)).toThrow(RangeError);
    expect(() => formatDate(0, 1)).toThrow(RangeError);
  });
});

describe('formatYear — masculine ordinal + «год»', () => {
  const table: [number, string][] = [
    [1987, 'тысяча девятьсот восемьдесят седьмой год'],
    [1990, 'тысяча девятьсот девяностый год'],
    [1900, 'тысяча девятисотый год'],
    [1941, 'тысяча девятьсот сорок первый год'],
    [2000, 'двухтысячный год'],
    [2001, 'две тысячи первый год'],
    [2010, 'две тысячи десятый год'],
    [2014, 'две тысячи четырнадцатый год'],
    [2026, 'две тысячи двадцать шестой год'],
    [2040, 'две тысячи сороковой год'],
    [2100, 'две тысячи сотый год'],
  ];
  it.each(table)('%i → %s', (y, words) => {
    expect(formatYear(y)).toBe(words);
  });
});

describe('guards + NFC', () => {
  it('rejects out-of-range and non-integers', () => {
    expect(() => cardinal(-1)).toThrow(RangeError);
    expect(() => cardinal(1.5)).toThrow(RangeError);
    expect(() => formatClock(24, 0)).toThrow(RangeError);
    expect(() => formatClock(10, 60)).toThrow(RangeError);
    expect(() => formatPrice(1, 100)).toThrow(RangeError);
  });

  it('returns NFC strings (ё preserved, composed)', () => {
    const s = formatDate(4, 8);
    expect(s).toBe(s.normalize('NFC'));
    expect(s).toContain('ё');
  });
});
