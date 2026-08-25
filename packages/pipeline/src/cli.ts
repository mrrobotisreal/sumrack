import { formatIssue, DraftError } from './errors.ts';
import { runAnnotate } from './annotate.ts';
import { runAudition, runFinalize } from './audio.ts';
import type { StampResult } from './stamps.ts';
import { ElevenLabsClient } from './elevenlabs.ts';
import { resolveEnvVar } from './env.ts';
import { runModelsMirror } from './models.ts';
import { runPublish } from './publish.ts';
import { runValidate } from './validate.ts';

/**
 * CLI entrypoint. annotate/validate are offline (T08); audio is explicitly
 * online (ElevenLabs, T09) and publish talks to the local content repo clone.
 * Exit codes: 0 success, 1 validation failure, 2 usage.
 */

const USAGE = `Sumrak authoring pipeline

Usage:
  pipeline annotate [draft.md ...] [--extras <extras.md>] [-o <pack.json>]
      Turn draft file(s) into a schema-valid pack.json.
      One draft = one story; multi-story packs pass several drafts (identical
      "pack" frontmatter) in reading order. Default output: ./pack.json
      --extras <file>       pack extras (T17): lesson (frontmatter meta +
                            markdown body), journal prompts, authored
                            exercises. Required sections for course-unit /
                            checkpoint / prompts packs; a pack with no story
                            drafts (checkpoint, prompts) passes ONLY --extras
                            (its frontmatter then carries the "pack:" meta)

  pipeline validate <pack.json> [more.json ...]
      Validate existing pack.json file(s) against the schema.

  pipeline audio <draft.md> [more-drafts.md ...] -o <pack-dir> [options]
      Render narration via ElevenLabs (needs ELEVENLABS_API_KEY in the env or
      a gitignored .env at the repo root; the value is never printed).
      --audition [N]        render N candidate takes per track (default 3) as
                            MP3s into <pack-dir>/audition/ — review before
                            finalizing; pack.json is not touched
      --seed <track>=<n>    finalize this track with the audition take's seed
                            (repeatable); bare --seed <n> applies to all
      --stories <id,id>     only these story ids
      --tracks <id,id>      only these track ids
      --model <id>          ElevenLabs model (default eleven_multilingual_v2)
      --extras <file>       pack extras file (course-unit packs) — merged into
                            the written pack.json, same as annotate
      Without --audition, renders final takes: Opus into <pack-dir>/audio/,
      word stamps mapped + checked, pack.json written (merges with a previous
      run, so tracks can be finalized story by story).

  pipeline publish <pack-dir> --content <sumrak-content-dir> [--push] [-m msg]
      Copy the pack into the content repo, recompute hashes, update
      manifest.json, and commit. Pushes only with --push.

  pipeline models mirror --content <sumrak-content-dir> [--push] [-m msg]
      Mirror the app's pinned speech-model archives (4 Piper TTS voices + the
      ASR model, ~330 MB) from the k2-fsa release assets into the content
      repo's models/{tts,asr}/, verifying each download against the pinned
      sha256 BEFORE writing into the repo, then emit models-manifest.json and
      commit. Idempotent: verified-present files are skipped, and model files
      are never deleted or overwritten. Pushes only with --push.

Run from the Sumrak repo root:  pnpm pipeline annotate <draft.md> -o <out.json>
(paths resolve against the repo root — pnpm runs scripts at the package root)`;

function fail(message: string, code: 1 | 2): never {
  console.error(message);
  process.exit(code);
}

function annotateCommand(args: string[]): void {
  const drafts: string[] = [];
  let out = 'pack.json';
  let extras: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-o' || arg === '--out') {
      const value = args[++i];
      if (value === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      out = value;
    } else if (arg === '--extras') {
      const value = args[++i];
      if (value === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      extras = value;
    } else if (arg.startsWith('-')) {
      fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    } else {
      drafts.push(arg);
    }
  }
  if (drafts.length === 0 && extras === undefined) {
    fail(
      `annotate needs at least one draft file (or --extras for a story-less pack)\n\n${USAGE}`,
      2,
    );
  }

  try {
    const summary = runAnnotate(drafts, out, extras);
    const extraBits = [
      summary.pack.lesson ? 'lesson' : null,
      summary.pack.prompts ? `${summary.pack.prompts.length} prompts` : null,
      summary.pack.exercises ? `${summary.pack.exercises.length} exercises` : null,
    ].filter((b): b is string => b !== null);
    console.log(
      `✓ ${summary.pack.id} v${summary.pack.version} → ${summary.outFile}\n` +
        `  ${summary.stories} stor${summary.stories === 1 ? 'y' : 'ies'}, ` +
        `${summary.sentences} sentences, ${summary.tokens} tokens` +
        `${extraBits.length > 0 ? ` + ${extraBits.join(', ')}` : ''} — schema-valid`,
    );
  } catch (e) {
    if (e instanceof DraftError) {
      fail(e.issues.map(formatIssue).join('\n'), 1);
    }
    throw e;
  }
}

function validateCommand(args: string[]): void {
  if (args.length === 0 || args.some((a) => a.startsWith('-'))) {
    fail(`validate needs one or more pack.json paths\n\n${USAGE}`, 2);
  }
  let failed = false;
  for (const file of args) {
    const result = runValidate(file);
    if (result.ok) {
      console.log(`✓ ${file}: valid pack "${result.pack.id}" v${result.pack.version}`);
    } else {
      failed = true;
      console.error(`✗ ${file}: invalid pack`);
      for (const issue of result.issues) console.error(`    ${issue.path}: ${issue.message}`);
    }
  }
  if (failed) process.exit(1);
}

function describeStamps(r: StampResult): string {
  if (!r.trusted) return `stamps DROPPED (${r.issues.join('; ')})`;
  const pct = (r.coverage * 100).toFixed(1);
  const extra = r.issues.length > 0 ? `; ${r.issues.join('; ')}` : '';
  return `${r.stampedTokens}/${r.wordTokens} words stamped (${pct}%), monotonic${extra}`;
}

function makeClient(): ElevenLabsClient {
  const apiKey = resolveEnvVar('ELEVENLABS_API_KEY');
  if (apiKey === undefined) {
    fail(
      'ELEVENLABS_API_KEY is not set — export it or put it in a gitignored .env at the repo root (the pipeline never prints its value)',
      2,
    );
  }
  return new ElevenLabsClient(apiKey);
}

async function audioCommand(args: string[]): Promise<void> {
  const drafts: string[] = [];
  let out: string | undefined;
  let audition = false;
  let takes = 3;
  let model: string | undefined;
  let stories: string[] | undefined;
  let tracks: string[] | undefined;
  let extras: string | undefined;
  const seeds: Record<string, number> = {};
  let defaultSeed: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = (): string => {
      const v = args[++i];
      if (v === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      return v;
    };
    if (arg === '-o' || arg === '--out') out = next();
    else if (arg === '--audition') {
      audition = true;
      const peek = args[i + 1];
      if (peek !== undefined && /^\d+$/.test(peek)) takes = Number.parseInt(args[++i]!, 10);
    } else if (arg === '--seed') {
      const v = next();
      const kv = /^([a-z0-9-]+)=(\d+)$/.exec(v);
      if (kv) seeds[kv[1]!] = Number.parseInt(kv[2]!, 10);
      else if (/^\d+$/.test(v)) defaultSeed = Number.parseInt(v, 10);
      else fail(`--seed expects <n> or <track-id>=<n>, got "${v}"`, 2);
    } else if (arg === '--stories') stories = next().split(',').filter(Boolean);
    else if (arg === '--tracks') tracks = next().split(',').filter(Boolean);
    else if (arg === '--model') model = next();
    else if (arg === '--extras') extras = next();
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else drafts.push(arg);
  }
  if (drafts.length === 0) fail(`audio needs at least one draft file\n\n${USAGE}`, 2);
  if (out === undefined) fail(`audio needs -o <pack-dir>\n\n${USAGE}`, 2);

  const client = makeClient();
  try {
    if (audition) {
      const result = await runAudition(drafts, out, client, {
        takes,
        stories,
        tracks,
        modelId: model,
        extrasPath: extras,
      });
      console.log(`Rendered ${result.length} audition take(s) into ${out}/audition/:`);
      for (const t of result) {
        console.log(`  ${t.trackId} take ${t.take} (seed ${t.seed}) → ${t.file}`);
        console.log(`      alignment: ${describeStamps(t.stampResult)}`);
      }
      console.log('\nListen, pick a take per track, then finalize with --seed <track-id>=<seed>.');
    } else {
      const summary = await runFinalize(drafts, out, client, {
        seeds,
        defaultSeed,
        stories,
        tracks,
        modelId: model,
        extrasPath: extras,
      });
      console.log(`✓ ${summary.pack.id} v${summary.pack.version} → ${summary.outFile}`);
      for (const r of summary.reports) {
        const kb = (r.opusBytes / 1024).toFixed(0);
        console.log(
          `  ${r.trackId} (${r.voice}, ${r.style}, seed ${r.seed}): ` +
            `${(r.durationMs / 1000).toFixed(1)}s, ${kb} KiB opus`,
        );
        console.log(`      stamps: ${describeStamps(r.stampResult)}`);
      }
    }
  } catch (e) {
    if (e instanceof DraftError) fail(e.issues.map(formatIssue).join('\n'), 1);
    fail(e instanceof Error ? e.message : String(e), 1);
  }
}

function publishCommand(args: string[]): void {
  let packDir: string | undefined;
  let content: string | undefined;
  let push = false;
  let message: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = (): string => {
      const v = args[++i];
      if (v === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      return v;
    };
    if (arg === '--content') content = next();
    else if (arg === '--push') push = true;
    else if (arg === '-m' || arg === '--message') message = next();
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else if (packDir === undefined) packDir = arg;
    else fail(`publish takes exactly one <pack-dir>\n\n${USAGE}`, 2);
  }
  if (packDir === undefined) fail(`publish needs a <pack-dir>\n\n${USAGE}`, 2);
  if (content === undefined) fail(`publish needs --content <sumrak-content-dir>\n\n${USAGE}`, 2);

  try {
    const summary = runPublish(packDir, content, { push, message });
    if (summary.outcome === 'unchanged') {
      console.log(`= ${summary.packId} v${summary.version} already published, nothing to do`);
      return;
    }
    const mb = (summary.totalBytes / (1024 * 1024)).toFixed(2);
    console.log(
      `✓ published ${summary.packId} v${summary.version} (${summary.files.length} files, ${mb} MB) — commit ${summary.committed}${summary.pushed ? ', pushed' : ' (not pushed; use --push)'}`,
    );
    for (const f of summary.files) console.log(`  ${f.path} (${f.bytes} bytes) ${f.sha256}`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 1);
  }
}

async function modelsCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub !== 'mirror') {
    fail(`models has one subcommand: mirror\n\n${USAGE}`, 2);
  }
  let content: string | undefined;
  let push = false;
  let message: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const next = (): string => {
      const v = rest[++i];
      if (v === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      return v;
    };
    if (arg === '--content') content = next();
    else if (arg === '--push') push = true;
    else if (arg === '-m' || arg === '--message') message = next();
    else fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
  }
  if (content === undefined)
    fail(`models mirror needs --content <sumrak-content-dir>\n\n${USAGE}`, 2);

  try {
    const summary = await runModelsMirror(content, { push, message });
    const mb = summary.models.reduce((n, m) => n + m.bytes, 0) / (1024 * 1024);
    console.log(
      `\n${summary.models.length} models mirrored (${mb.toFixed(0)} MB total), ` +
        `manifest ${summary.manifest}` +
        (summary.outcome === 'committed'
          ? ` — commit ${summary.committed}${summary.pushed ? ', pushed' : ' (not pushed; use --push)'}`
          : ' — nothing to commit (already up to date)'),
    );
    for (const m of summary.models) {
      console.log(
        `  ${m.action === 'downloaded' ? '✓' : '='} ${m.id} → ${m.file} (${m.bytes} bytes) ${m.sha256}`,
      );
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 1);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'annotate':
      annotateCommand(rest);
      break;
    case 'validate':
      validateCommand(rest);
      break;
    case 'audio':
      await audioCommand(rest);
      break;
    case 'publish':
      publishCommand(rest);
      break;
    case 'models':
      await modelsCommand(rest);
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      break;
    default:
      fail(`unknown command "${command}"\n\n${USAGE}`, 2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
