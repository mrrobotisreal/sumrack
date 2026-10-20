import type { EndingPair, YoPolicy } from './catalog';

/** Stress marks, case and punctuation are not tested. ё policy is per activity. */
export function words(text: string, policy: YoPolicy): string[] {
  const normalized = text
    .normalize('NFC')
    .toLocaleLowerCase('ru')
    .replace(/\u0301/g, '');
  return (
    (policy === 'fold' ? normalized.replace(/ё/g, 'е') : normalized).match(
      /[а-яёa-z0-9]+(?:[-’'][а-яёa-z0-9]+)*/gu,
    ) ?? []
  );
}
export type DifferenceKind = 'correct' | 'missing' | 'extra' | 'wrong' | 'spelling' | 'ending';
export interface Difference {
  kind: DifferenceKind;
  expected: string | null;
  actual: string | null;
  note?: string;
}

function distance(a: readonly string[], b: readonly string[]): number[][] {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + Number(a[i - 1] !== b[j - 1]),
      );
  return d;
}

/** Word alignment first; only explicit reviewed substitutions are labelled ending errors. */
export function compareDictation(
  expectedText: string,
  actualText: string,
  policy: YoPolicy,
  endings: readonly EndingPair[] = [],
): Difference[] {
  const a = words(expectedText, policy),
    b = words(actualText, policy),
    d = distance(a, b);
  let i = a.length,
    j = b.length;
  const result: Difference[] = [];
  while (i || j) {
    if (i && j && d[i]![j] === d[i - 1]![j - 1]! + Number(a[i - 1] !== b[j - 1])) {
      const expected = a[--i]!,
        actual = b[--j]!;
      const ending = endings.find(
        (p) => words(p.expected, policy)[0] === expected && words(p.actual, policy)[0] === actual,
      );
      const charDistance = distance([...expected], [...actual])[expected.length]![actual.length]!;
      const kind =
        expected === actual
          ? 'correct'
          : ending
            ? 'ending'
            : Math.min(expected.length, actual.length) >= 4 && charDistance === 1
              ? 'spelling'
              : 'wrong';
      result.unshift({ kind, expected, actual, ...(ending ? { note: ending.note } : {}) });
    } else if (i && d[i]![j] === d[i - 1]![j]! + 1)
      result.unshift({ kind: 'missing', expected: a[--i]!, actual: null });
    else result.unshift({ kind: 'extra', expected: null, actual: b[--j]! });
  }
  return result;
}
