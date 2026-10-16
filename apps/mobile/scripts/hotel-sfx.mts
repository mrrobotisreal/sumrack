/**
 * T91 SFX generator: the seven lift sound effects via the ElevenLabs
 * Sound Effects API (POST /v1/sound-generation).
 *
 * Writes THREE raw mp3 takes per clip into an output directory OUTSIDE the
 * repo (default `<workspace>/_sfx-takes/hotel`, or the first argument). Takes
 * are chosen later by number (ffprobe duration + astats, see SFX.md). Requests
 * run strictly one at a time. The key is read via resolveEnvVar and is never
 * printed; the .env lives in the main Sumrak checkout, found through git.
 *
 * Run ONLY inside the `_locks/elevenlabs.lock` guard (orchestration §3):
 *   npx tsx scripts/hotel-sfx.mts [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveEnvVar } from '../../../packages/pipeline/src/env.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Main checkout root (holds the gitignored .env), resolved from the worktree's git common dir. */
function mainCheckoutRoot(): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: HERE,
    encoding: 'utf8',
  }).trim();
  return dirname(common);
}

export interface SfxClip {
  slug: string;
  prompt: string;
  durationSeconds: number;
  /** Loudness target after normalisation (LUFS). */
  lufs: number;
}

export const SFX_CLIPS: SfxClip[] = [
  {
    slug: 'lift-close',
    prompt: 'old brass elevator doors sliding shut, heavy, 1930s hotel, metallic rumble',
    durationSeconds: 1.2,
    lufs: -20,
  },
  {
    slug: 'lift-ride',
    prompt: 'old elevator car humming and creaking while moving, cables, steady loop',
    durationSeconds: 4,
    lufs: -20,
  },
  {
    slug: 'lift-ding',
    prompt: 'single soft old elevator bell ding, brass',
    durationSeconds: 1.2,
    lufs: -20,
  },
  {
    slug: 'lift-open',
    prompt: 'old elevator doors sliding open, heavy brass, slight creak',
    durationSeconds: 1.2,
    lufs: -20,
  },
  {
    slug: 'flicker',
    prompt: 'fluorescent light buzzing and flickering, electrical tick',
    durationSeconds: 0.8,
    lufs: -20,
  },
  {
    slug: 'drop',
    prompt:
      'elevator cable snapping, car free-falling with metal rattling, then a violent crash impact',
    durationSeconds: 3.5,
    lufs: -16,
  },
  {
    slug: 'lift-blocked',
    prompt: 'dull mechanical clunk of a stuck elevator button',
    durationSeconds: 0.5,
    lufs: -20,
  },
];

export const TAKES_PER_CLIP = 3;

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? join(mainCheckoutRoot(), '..', '_sfx-takes', 'hotel'));
  mkdirSync(outDir, { recursive: true });
  const apiKey = resolveEnvVar('ELEVENLABS_API_KEY', mainCheckoutRoot());
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set (env or .env)');

  for (const clip of SFX_CLIPS) {
    for (let take = 1; take <= TAKES_PER_CLIP; take++) {
      const path = join(outDir, `${clip.slug}-${take}.mp3`);
      const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clip.prompt,
          duration_seconds: clip.durationSeconds,
          prompt_influence: 0.5,
        }),
      });
      if (!res.ok) {
        // Status and short body only; the key never appears in either.
        const body = (await res.text()).slice(0, 200);
        throw new Error(`${clip.slug} take ${take}: HTTP ${res.status} ${body}`);
      }
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      console.log(`${clip.slug} take ${take} -> ${path}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
