/**
 * Month-grid helpers for the exam-date sheet (T69). Pure string arithmetic
 * over 'YYYY-MM' / 'YYYY-MM-DD' keys — no Date objects carrying a timezone
 * (the lib/dates rule), Monday-first like a Russian calendar.
 */

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function parse(month: string): { y: number; m: number } {
  const [y, m] = month.split('-').map(Number);
  return { y: y!, m: m! };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM' + n months. */
export function shiftMonth(month: string, n: number): string {
  const { y, m } = parse(month);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** «Октябрь 2026». */
export function monthTitle(month: string): string {
  const { y, m } = parse(month);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * The month as day keys, padded with leading `null`s so index 0 is a Monday
 * (and trailing nulls to a whole week).
 */
export function monthGrid(month: string): (string | null)[] {
  const { y, m } = parse(month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const lead = (firstDow + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
