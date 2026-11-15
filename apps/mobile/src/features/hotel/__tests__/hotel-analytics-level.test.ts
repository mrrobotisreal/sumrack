import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { HOTEL_LEVEL_EVENTS, trackHotel } from '../hotel-analytics';

/**
 * T116 (HOTEL_PATH_A2 H8): the building rule for hotel analytics — the six
 * lift / gate / cooldown events and `hotel_building_switched` carry `level`
 * and go through `trackHotel`. A source scan, like the TORFL level rule.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function callArgs(source: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIdx + 1, i);
    }
  }
  return source.slice(openParenIdx + 1);
}

describe('hotel analytics: THE BUILDING RULE (source scan)', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith(`${path.sep}hotel-analytics.ts`));
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
  const bare = new RegExp(`\\btrack\\(\\s*['"](${HOTEL_LEVEL_EVENTS.join('|')})['"]`);

  it('no bare track() of a building-scoped hotel event', () => {
    expect(files.filter((f) => bare.test(fs.readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('every trackHotel( call passes a level prop', () => {
    const missing: string[] = [];
    for (const f of files) {
      const source = fs.readFileSync(f, 'utf8');
      for (const m of source.matchAll(/\btrackHotel\(/g)) {
        const args = callArgs(source, (m.index ?? 0) + m[0].length - 1);
        if (!/\blevel\b/.test(args)) {
          missing.push(`${rel(f)}:${source.slice(0, m.index ?? 0).split('\n').length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every building-scoped event is fired somewhere', () => {
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const e of HOTEL_LEVEL_EVENTS)
      expect(all, e).toMatch(new RegExp(`trackHotel\\(\\s*'${e}'`));
  });
});

describe('trackHotel typing', () => {
  it('requires a level prop', () => {
    expectTypeOf<Parameters<typeof trackHotel>[1]>().toHaveProperty('level');
    // @ts-expect-error — `level` is required
    const bad: Parameters<typeof trackHotel>[1] = { floor: 1 };
    void bad;
  });
});
