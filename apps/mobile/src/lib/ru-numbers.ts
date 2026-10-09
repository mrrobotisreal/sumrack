/**
 * Russian number rendering (T34, V2 §7.5) — pure, table-driven, no Intl.
 * The numbers drill speaks what these functions return: Piper is never
 * handed a digit string (its digit reading is unreliable — recorded T34
 * principle), so every word the learner hears is built here.
 *
 * CONVENTIONS (recorded in the T34 ticket row):
 * - Cardinals 0 … 999 999 999; the drill uses 0 … 1 000 000.
 * - A LEADING group whose count is exactly 1 drops «один/одна»: 1 000 =
 *   «тысяча», 1 500 = «тысяча пятьсот», 1 000 000 = «миллион» — but 21 000 =
 *   «двадцать одна тысяча» and 2 001 001 = «два миллиона одна тысяча один»
 *   (mid-number the 1 is said and agrees).
 * - Gender agreement on 1 and 2 only (один/одна/одно, два/две); the thousands
 *   group is always feminine, millions masculine.
 * - Plural form choice ({@link pluralForm}): n mod 100 in 11–14 → many;
 *   else n mod 10 = 1 → one, 2–4 → few, otherwise many.
 * - Prices: «N рублей M копеек» (rouble masc., kopeck fem.); also the hryvnia
 *   (fem.: гривна/гривны/гривен) for Mitch's Ukrainian context; kopecks 0 are
 *   omitted, roubles 0 with kopecks reads kopecks only.
 * - Clock: two styles. `digital` = how a clock face is read aloud —
 *   «четырнадцать тридцать», minutes 00 → «ноль-ноль», 01–09 → «ноль пять»,
 *   minutes take the feminine (implicit «минута»: «девять двадцать одна»).
 *   `full` = «четырнадцать часов тридцать минут» with hour/minute plural
 *   agreement; 00 minutes reads hours only. Casual «половина третьего» /
 *   «без четверти» are out of scope (future tier).
 * - Dates: neuter ordinal day + genitive month — «пятое марта».
 * - Years: masculine nominative ordinal + «год» — «тысяча девятьсот
 *   восемьдесят седьмой год», «двухтысячный год».
 * - Ages: «N год/года/лет» — «двадцать один год», «двадцать два года».
 * Every returned string is NFC.
 */

export type Gender = 'm' | 'f' | 'n';

const UNITS_M = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
] as const;

const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
] as const;

const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
] as const;

const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
] as const;

/** Masculine nominative ordinals 1–19 (index = number). */
const ORD_UNITS = [
  '',
  'первый',
  'второй',
  'третий',
  'четвёртый',
  'пятый',
  'шестой',
  'седьмой',
  'восьмой',
  'девятый',
  'десятый',
  'одиннадцатый',
  'двенадцатый',
  'тринадцатый',
  'четырнадцатый',
  'пятнадцатый',
  'шестнадцатый',
  'семнадцатый',
  'восемнадцатый',
  'девятнадцатый',
] as const;

const ORD_TENS = [
  '',
  '',
  'двадцатый',
  'тридцатый',
  'сороковой',
  'пятидесятый',
  'шестидесятый',
  'семидесятый',
  'восьмидесятый',
  'девяностый',
] as const;

const ORD_HUNDREDS = [
  '',
  'сотый',
  'двухсотый',
  'трёхсотый',
  'четырёхсотый',
  'пятисотый',
  'шестисотый',
  'семисотый',
  'восьмисотый',
  'девятисотый',
] as const;

/** Genitive-compound prefixes for round-thousand ordinals («двухтысячный»). */
const ORD_THOUSAND_PREFIX = [
  '',
  '',
  'двух',
  'трёх',
  'четырёх',
  'пяти',
  'шести',
  'семи',
  'восьми',
  'девяти',
] as const;

/** Genitive month names (dates: «пятое марта»). Index 0 = January. */
export const RU_MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

export const MAX_CARDINAL = 999_999_999;

function nfc(s: string): string {
  return s.normalize('NFC');
}

function assertInt(n: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`${what}: ${n} is not an integer in ${min}…${max}`);
  }
}

/**
 * The Russian 1 / 2–4 / 5+ form choice with the 11–14 exception:
 * pluralForm(21, ['год','года','лет']) → 'год', (22) → 'года', (12) → 'лет'.
 */
export function pluralForm<T>(n: number, forms: readonly [one: T, few: T, many: T]): T {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = abs % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** 1 and 2 agree with the counted noun; every other unit is gender-neutral. */
function unitWord(u: number, gender: Gender): string {
  if (u === 1) return gender === 'f' ? 'одна' : gender === 'n' ? 'одно' : 'один';
  if (u === 2) return gender === 'f' ? 'две' : 'два';
  return UNITS_M[u]!;
}

/** Words for 1–999 (never 0), agreeing in gender. */
function triadWords(n: number, gender: Gender): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) words.push(HUNDREDS[h]!);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]!);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t > 0) words.push(TENS[t]!);
    if (u > 0) words.push(unitWord(u, gender));
  }
  return words;
}

/**
 * Integer → Russian cardinal words. `gender` agrees the final 1/2 with the
 * counted noun (default masculine): cardinal(21, 'f') → «двадцать одна».
 */
export function cardinal(n: number, gender: Gender = 'm'): string {
  assertInt(n, 0, MAX_CARDINAL, 'cardinal');
  if (n === 0) return 'ноль';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;
  const words: string[] = [];
  if (millions > 0) {
    if (millions !== 1) words.push(...triadWords(millions, 'm'));
    words.push(pluralForm(millions, ['миллион', 'миллиона', 'миллионов']));
  }
  if (thousands > 0) {
    // «одна» is dropped only when the thousands group leads the number.
    if (thousands !== 1 || millions > 0) words.push(...triadWords(thousands, 'f'));
    words.push(pluralForm(thousands, ['тысяча', 'тысячи', 'тысяч']));
  }
  if (units > 0) words.push(...triadWords(units, gender));
  return nfc(words.join(' '));
}

/** Masculine nominative ordinal for 1 … 999 999 (only the last word inflects). */
function ordinalMasc(n: number): string {
  assertInt(n, 1, 999_999, 'ordinal');
  if (n % 1000 === 0) {
    const k = n / 1000;
    if (k === 1) return 'тысячный';
    if (k < 10) return `${ORD_THOUSAND_PREFIX[k]}тысячный`;
    // Rare compounds («двадцатитысячный») — not needed by any drill tier.
    throw new RangeError(`ordinal: round thousands above 9000 unsupported (${n})`);
  }
  const lastTwo = n % 100;
  if (lastTwo !== 0) {
    const prefix = n - lastTwo > 0 ? `${cardinal(n - lastTwo)} ` : '';
    let tail: string;
    if (lastTwo < 20) tail = ORD_UNITS[lastTwo]!;
    else if (lastTwo % 10 === 0) tail = ORD_TENS[lastTwo / 10]!;
    else tail = `${TENS[Math.floor(lastTwo / 10)]} ${ORD_UNITS[lastTwo % 10]}`;
    return prefix + tail;
  }
  // Ends in a round hundred: 1900 → «тысяча девятисотый».
  const hundreds = (n % 1000) / 100;
  const prefix = n - (n % 1000) > 0 ? `${cardinal(n - (n % 1000))} ` : '';
  return prefix + ORD_HUNDREDS[hundreds]!;
}

/** Re-ends the last word of a masculine ordinal for the gender/case asked. */
function reEndOrdinal(masc: string, ending: 'n' | 'f' | 'gen'): string {
  const cut = masc.lastIndexOf(' ');
  const head = cut >= 0 ? masc.slice(0, cut + 1) : '';
  const last = cut >= 0 ? masc.slice(cut + 1) : masc;
  // «третий» is the one soft-stem ordinal.
  if (last.endsWith('ий')) {
    const stem = last.slice(0, -2);
    const end = ending === 'n' ? 'ье' : ending === 'f' ? 'ья' : 'ьего';
    return head + stem + end;
  }
  const stem = last.slice(0, -2);
  const end = ending === 'n' ? 'ое' : ending === 'f' ? 'ая' : 'ого';
  return head + stem + end;
}

/** Nominative ordinal in a gender: ordinal(5, 'n') → «пятое». */
export function ordinal(n: number, gender: Gender = 'm'): string {
  const masc = ordinalMasc(n);
  return nfc(gender === 'm' ? masc : reEndOrdinal(masc, gender));
}

/** Masculine/neuter genitive ordinal: ordinalGenitive(1987) → «… восемьдесят седьмого». */
export function ordinalGenitive(n: number): string {
  return nfc(reEndOrdinal(ordinalMasc(n), 'gen'));
}

export type Currency = 'rub' | 'uah';

const CURRENCY: Record<Currency, { gender: Gender; forms: readonly [string, string, string] }> = {
  rub: { gender: 'm', forms: ['рубль', 'рубля', 'рублей'] },
  uah: { gender: 'f', forms: ['гривна', 'гривны', 'гривен'] },
};

const KOPECK_FORMS = ['копейка', 'копейки', 'копеек'] as const;

/** «N <noun>» with gender agreement and the plural form — the building block. */
export function countNoun(
  n: number,
  gender: Gender,
  forms: readonly [string, string, string],
): string {
  return nfc(`${cardinal(n, gender)} ${pluralForm(n, forms)}`);
}

/**
 * A price: formatPrice(125) → «сто двадцать пять рублей»;
 * formatPrice(12, 50) → «двенадцать рублей пятьдесят копеек»;
 * formatPrice(0, 1) → «одна копейка»; formatPrice(2, 0, 'uah') → «две гривны».
 */
export function formatPrice(whole: number, kopecks = 0, currency: Currency = 'rub'): string {
  assertInt(whole, 0, MAX_CARDINAL, 'price');
  assertInt(kopecks, 0, 99, 'kopecks');
  const { gender, forms } = CURRENCY[currency];
  const parts: string[] = [];
  if (whole > 0 || kopecks === 0) parts.push(countNoun(whole, gender, forms));
  if (kopecks > 0) parts.push(countNoun(kopecks, 'f', KOPECK_FORMS));
  return nfc(parts.join(' '));
}

export type ClockStyle = 'digital' | 'full';

/**
 * A clock time, 24-hour. digital: formatClock(14, 30) → «четырнадцать
 * тридцать», (9, 5) → «девять ноль пять», (7, 0) → «семь ноль-ноль»;
 * full: (14, 30) → «четырнадцать часов тридцать минут», (1, 21) → «один час
 * двадцать одна минута», (22, 0) → «двадцать два часа».
 */
export function formatClock(hours: number, minutes: number, style: ClockStyle = 'digital'): string {
  assertInt(hours, 0, 23, 'hours');
  assertInt(minutes, 0, 59, 'minutes');
  if (style === 'full') {
    const h = countNoun(hours, 'm', ['час', 'часа', 'часов']);
    if (minutes === 0) return h;
    return nfc(`${h} ${countNoun(minutes, 'f', ['минута', 'минуты', 'минут'])}`);
  }
  const h = cardinal(hours);
  let m: string;
  if (minutes === 0) m = 'ноль-ноль';
  else if (minutes < 10) m = `ноль ${cardinal(minutes, 'f')}`;
  else m = cardinal(minutes, 'f');
  return nfc(`${h} ${m}`);
}

/** Days in a month, for validation (leap-year Feb = 29; no year context). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A date: formatDate(5, 3) → «пятое марта» (month 1–12). */
export function formatDate(day: number, month: number): string {
  assertInt(month, 1, 12, 'month');
  assertInt(day, 1, MONTH_DAYS[month - 1]!, 'day');
  return nfc(`${ordinal(day, 'n')} ${RU_MONTHS_GENITIVE[month - 1]}`);
}

/** A year as said on its own: formatYear(1987) → «тысяча девятьсот восемьдесят седьмой год». */
export function formatYear(year: number): string {
  assertInt(year, 1, 9999, 'year');
  return nfc(`${ordinal(year)} год`);
}

/** An age: formatAge(21) → «двадцать один год», (3) → «три года», (11) → «одиннадцать лет». */
export function formatAge(years: number): string {
  assertInt(years, 0, 150, 'age');
  return countNoun(years, 'm', ['год', 'года', 'лет']);
}
