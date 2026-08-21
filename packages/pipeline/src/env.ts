import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal env loading for the pipeline's online steps (T09).
 *
 * The ElevenLabs key is environment-only by policy (workspace CLAUDE.md): it
 * must never be committed, logged, or printed. Besides the process
 * environment, we accept a gitignored `.env` / `.env.local` at the repo root
 * so the key never has to live in a shell profile. Values are returned to the
 * caller and NEVER logged here.
 */

const ENV_FILES = ['.env.local', '.env'];

/** Parse simple KEY=VALUE lines (no export, no multiline, # comments). */
function parseEnvFile(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Resolve one env var: process env first, then `.env.local` / `.env` at
 * `rootDir` (the repo root when run via `pnpm pipeline`). Returns undefined
 * when absent everywhere.
 */
export function resolveEnvVar(name: string, rootDir: string = process.cwd()): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  for (const file of ENV_FILES) {
    const path = join(rootDir, file);
    if (!existsSync(path)) continue;
    const value = parseEnvFile(readFileSync(path, 'utf8')).get(name);
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}
