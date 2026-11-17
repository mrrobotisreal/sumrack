import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ISS-006 F3: expo-audio's audio mode is ONE global per process, last writer
 * wins. Its native `setAudioModeAsync` (57.0.4, Android `AudioModule.kt`, iOS
 * `AudioModule.swift`) assigns `shouldPlayInBackground = mode.shouldPlayInBackground`
 * — an omitted flag is `false` — and `OnActivityEntersBackground` /
 * `OnAppEntersBackground` then pause EVERY player. So a call that omits the flag
 * switches the narration's «listen like a podcast» background play off.
 * Every call site in the app must therefore pass `shouldPlayInBackground: true`;
 * the ambient / score player goes quiet in the background through its own
 * playback policy (`foreground`), never through the global flag.
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

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

describe('audio mode: nobody switches background playback off (ISS-006 F3)', () => {
  const calls = sourceFiles(SRC).flatMap((f) => {
    const source = fs.readFileSync(f, 'utf8');
    return [...source.matchAll(/\bsetAudioModeAsync\(/g)].map((m) => ({
      at: `${rel(f)}:${source.slice(0, m.index ?? 0).split('\n').length}`,
      args: callArgs(source, (m.index ?? 0) + m[0].length - 1),
    }));
  });

  it('finds the three mode writers (reader narration, listen player, ambient host)', () => {
    const files = new Set(calls.map((c) => c.at.split(':')[0]));
    expect(files).toEqual(
      new Set([
        'features/reader/use-narration.ts',
        'features/listen/listen-service.ts',
        'features/ambient-audio/ambient-audio-host.tsx',
      ]),
    );
  });

  it('every setAudioModeAsync call passes shouldPlayInBackground: true', () => {
    const lowering = calls
      .filter((c) => !/\bshouldPlayInBackground:\s*true\b/.test(c.args))
      .map((c) => c.at);
    expect(lowering).toEqual([]);
  });

  it('the ambient host still keeps its own player foreground-only (policy, not the global flag)', () => {
    const policy = fs.readFileSync(
      path.join(SRC, 'features/ambient-audio/playback-policy.ts'),
      'utf8',
    );
    expect(policy).toMatch(/context\.foreground &&/);
    const host = fs.readFileSync(
      path.join(SRC, 'features/ambient-audio/ambient-audio-host.tsx'),
      'utf8',
    );
    expect(host).toMatch(/AppState\.addEventListener\('change'/);
    expect(host).toMatch(/foreground = state === 'active'/);
  });
});
