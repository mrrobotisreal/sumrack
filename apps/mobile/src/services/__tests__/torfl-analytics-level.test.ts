import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { trackTorfl } from '../analytics';

/**
 * THE LEVEL RULE for analytics (T75, TORFL_A2 A2-12): every `torfl_*` /
 * `exam_*` event carries `level`, and call sites go through `trackTorfl`
 * (never a bare `track('torfl_…' | 'exam_…')`). This test scans the source
 * tree so a new call site cannot quietly drop the prop.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Bare `track('torfl_…')` / `track('exam_…')` — the pattern the wrapper replaces. */
const BARE_TRACK = /\btrack\(\s*['"](torfl|exam)_/;

/** Every `trackTorfl(` occurrence (not the wrapper's own definition). */
const TRACK_TORFL_CALL = /\btrackTorfl\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

/** The text of a call's argument list, from the `(` after `trackTorfl` to its matching `)`. */
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

/** T75: files still allowed a bare `track(` of a TORFL event — empty (the integration converted the last six). */
const PENDING: readonly string[] = [];

describe('TORFL analytics: THE LEVEL RULE (source scan)', () => {
  const files = sourceFiles(SRC).filter(
    (f) => !f.endsWith(`${path.sep}services${path.sep}analytics.ts`),
  );
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

  it('no bare track() of a torfl_* / exam_* event outside the pending list', () => {
    const offenders = files
      .filter((f) => BARE_TRACK.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .filter((f) => !PENDING.includes(f));
    expect(offenders).toEqual([]);
  });

  it('every trackTorfl( call passes a level prop', () => {
    const missing: string[] = [];
    for (const f of files) {
      const source = fs.readFileSync(f, 'utf8');
      for (const m of source.matchAll(TRACK_TORFL_CALL)) {
        const open = (m.index ?? 0) + m[0].length - 1;
        const args = callArgs(source, open);
        if (!/\blevel\b/.test(args)) {
          const line = source.slice(0, m.index ?? 0).split('\n').length;
          missing.push(`${rel(f)}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the PENDING list only names files that still exist', () => {
    const existing = new Set(files.map(rel));
    expect(PENDING.filter((p) => !existing.has(p))).toEqual([]);
  });
});

describe('trackTorfl typing', () => {
  it('requires a level prop', () => {
    const ok: Parameters<typeof trackTorfl>[1] = { level: 'A2' };
    expect(ok.level).toBe('A2');
    expectTypeOf<Parameters<typeof trackTorfl>[1]>().toHaveProperty('level');
    // @ts-expect-error — `level` is required; a props object without it must not compile
    const bad: Parameters<typeof trackTorfl>[1] = { pct: 1 };
    void bad;
  });
});
