import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatIssue, DraftError } from './errors.ts';
import { runAnnotate } from './annotate.ts';
import { renderBranchMap, renderScenarioBranchMap } from './branch-map.ts';
import { glossaryCoverage, renderCoverageReport } from './coverage.ts';
import { renderExamReports } from './exam-report.ts';
import { renderCourseReport } from './course-report.ts';
import { courseManifestIssues, defaultManifestPath } from './course-manifest.ts';
import {
  planAudioRun,
  runAudition,
  runFinalize,
  runMouthOnly,
  type AudioRunPlan,
} from './audio.ts';
import type { StampResult } from './stamps.ts';
import { DEFAULT_MODEL_ID, ElevenLabsClient } from './elevenlabs.ts';
import { resolveEnvVar } from './env.ts';
import { runModelsMirror } from './models.ts';
import { runPublish } from './publish.ts';
import {
  auditPack,
  formatAuditTable,
  alignerPreflight,
  pythonAligner,
  restampPack,
  type PackAudit,
} from './stamp-audit.ts';
import { runValidate } from './validate.ts';
import { safeParsePack, type Pack } from '@sumrak/schema';

/**
 * CLI entrypoint. annotate/validate are offline (T08); audio is explicitly
 * online (ElevenLabs, T09) and publish talks to the local content repo clone.
 * Exit codes: 0 success, 1 validation failure, 2 usage.
 */

const USAGE = `Sumrak authoring pipeline

Usage:
  pipeline annotate [draft.md ...] [--extras <extras.md>] [-o <pack.json>]
      Turn draft file(s) into a schema-valid pack.json.
      One draft = one story (or one dialogue / one scenario, told apart by
      the frontmatter); multi-story packs pass several drafts (identical
      "pack" frontmatter) in reading order. Default output: ./pack.json
      Dialogues and scenarios also print their branch map; scenarios print
      the glossary coverage report (content lemmas the cast says that are
      not glossary headwords)
      --extras <file>       pack extras (T17): lesson (frontmatter meta +
                            markdown body), journal prompts, authored
                            exercises. Required sections for course-unit /
                            checkpoint / prompts packs; a pack with no story
                            drafts (checkpoint, prompts) passes ONLY --extras
                            (its frontmatter then carries the "pack:" meta)

  pipeline validate <pack.json> [more.json ...] [--manifest <manifest.json>]
      Validate existing pack.json file(s) against the schema. Reference
      packs (T38) print a census line per lemma list; they are hand-
      assembled JSON (no annotate) and publish like any pack. Course packs
      (T88) print the floor report; their practice and library refs are
      checked against --manifest (default ../sumrak-content/manifest.json
      when present, else a warning line)

  pipeline audio <draft.md> [more-drafts.md ...] -o <pack-dir> [options]
      Render narration via ElevenLabs (needs ELEVENLABS_API_KEY in the env or
      a gitignored .env at the repo root; the value is never printed).
      Every run first prints a pre-render summary (tracks, dialogue nodes,
      request + character counts) and asks for confirmation — pass --yes to
      skip the prompt (required for non-interactive runs).
      --audition [N]        render N candidate takes per track (default 3) as
                            MP3s into <pack-dir>/audition/ — review before
                            finalizing; pack.json is not touched. Dialogues
                            audition ONE representative (longest) line per
                            dialogue/character group
      --seed <track>=<n>    finalize this track with the audition take's seed
                            (repeatable); bare --seed <n> applies to all.
                            Dialogue groups are keyed <dialogueId>/<characterId>
      --stories <id,id>     only these story ids
      --tracks <id,id>      only these track ids
      --dialogues <id,id>   only these dialogue ids (T26)
      --scenarios <id,id>   only these scenario ids (T57)
      --player-audio        also render coach audio (the "player" character's
                            voice) for every choice + scripted player line
                            (dialogues) and for accept[0] of every
                            expectation (scenarios, → expect.coachAudio)
      --no-restamp          (finalize) keep the provider's character-time stamps;
                            by default every story track is re-stamped from its
                            Opus by forced alignment (T80; needs the aligner venv)
      --mouth-only          no rendering: recompute the mouth track of every
                            already-rendered scenario line in <pack-dir>/
                            pack.json from the Opus on disk (T57 tuning);
                            drafts are optional, zero provider calls
      --model <id>          ElevenLabs model (default ${DEFAULT_MODEL_ID};
                            eleven_v3 opt-in — a draft's per-direction
                            "model:" always wins over this flag)
      --extras <file>       pack extras file (course-unit packs) — merged into
                            the written pack.json, same as annotate
      --yes                 confirm the pre-render summary without prompting
      Without --audition, renders final takes: Opus into <pack-dir>/audio/
      (dialogues: audio/<dialogue-id>/<sentence-id>.opus per node/choice;
      scenarios: audio/<scenario-id>/<sentence-id>.opus per line with a
      per-variant v2 steering + a mouth track, coach files <turn-id>-coach),
      word stamps mapped + checked, pack.json written (merges with a previous
      run, so tracks/nodes/lines can be finalized in batches).

  pipeline publish <pack-dir> --content <sumrak-content-dir> [--push] [-m msg]
                   [--allow-stamp-risk] [--skip-stamp-audit]
      Copy the pack into the content repo, recompute hashes, update
      manifest.json, and commit. Pushes only with --push. Runs stamp-audit
      first and refuses on failure (--allow-stamp-risk logs the override to
      <pack-dir>/BUILD_NOTES.md; --skip-stamp-audit is for packs with no
      word-sliced audio and needs the aligner venv otherwise).

  pipeline stamp-audit <pack-dir|pack.json>... [--track id] [--json out.json]
      T80: offline word-stamp accuracy audit over the real audio (forced
      alignment; no network, no API key). Per track: median / p95 |offset|,
      step, drift, end-clip risk, token-index + lemma lint. Exit 1 over the
      thresholds (median > 40 ms, p95 > 120 ms, any step > 250 ms, drift >
      20 ms/min, any structural/lemma hit).

  pipeline restamp <pack-dir|pack.json> [--track id] [-o out.json]
      T80: recompute every word stamp from the PUBLISHED audio (forced
      alignment + energy snapping). Changes only audio[].timestamps
      (asserted); writes in place unless -o is given. Never re-renders.

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
      summary.dialogues > 0
        ? `${summary.dialogues} dialogue${summary.dialogues === 1 ? '' : 's'}`
        : null,
      summary.scenarios > 0
        ? `${summary.scenarios} scenario${summary.scenarios === 1 ? '' : 's'}`
        : null,
      summary.exams > 0 ? `${summary.exams} exam${summary.exams === 1 ? '' : 's'}` : null,
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
    for (const dialogue of summary.pack.dialogues ?? []) {
      console.log(`\n${renderBranchMap(dialogue)}`);
    }
    printScenarioReports(summary.pack);
    printExamReports(summary.pack);
  } catch (e) {
    if (e instanceof DraftError) {
      fail(e.issues.map(formatIssue).join('\n'), 1);
    }
    throw e;
  }
}

/** T56: branch map + glossary coverage report for every scenario of a pack. */
function printScenarioReports(pack: Pack): void {
  for (const scenario of pack.scenarios ?? []) {
    console.log(`\n${renderScenarioBranchMap(scenario)}`);
    console.log(`\n${renderCoverageReport(glossaryCoverage(scenario))}`);
  }
}

/** T67: matrix map, topic census, official-shape check, ref table for every exam (warnings only). */
function printExamReports(pack: Pack): void {
  for (const report of renderExamReports(pack)) console.log(`\n${report}`);
}

/** T38: one census line per reference lemma list (count + POS mix). */
function printReferenceReports(pack: Pack): void {
  for (const list of pack.lemmaLists ?? []) {
    const byPos = new Map<string, number>();
    for (const l of list.lemmas) byPos.set(l.pos ?? '—', (byPos.get(l.pos ?? '—') ?? 0) + 1);
    const mix = [...byPos.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pos, n]) => `${pos} ${n}`)
      .join(' · ');
    const glossed = list.lemmas.filter((l) => l.translation).length;
    console.log(
      `  lemma list "${list.id}" (${list.level}): ${list.lemmas.length} lemmas, ${glossed} glossed — ${mix}`,
    );
  }
}

/**
 * T88: a published pack's pack.json, read from the sumrak-content checkout the
 * manifest sits in (`packs/<id>/pack.json`). Undefined when it is not there.
 */
function readPublishedPack(manifestPath: string, id: string): Pack | undefined {
  const file = join(dirname(manifestPath), 'packs', id, 'pack.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as Pack;
}

function validateCommand(args: string[]): void {
  const files: string[] = [];
  let manifest: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--manifest') {
      const value = args[++i];
      if (value === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      manifest = value;
    } else if (arg.startsWith('-')) {
      fail(`validate needs one or more pack.json paths\n\n${USAGE}`, 2);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) {
    fail(`validate needs one or more pack.json paths\n\n${USAGE}`, 2);
  }
  // T88: the live manifest, when one is reachable, for course refs (decision 5).
  const manifestPath = manifest ?? defaultManifestPath();
  let failed = false;
  for (const file of files) {
    const result = runValidate(file);
    if (result.ok) {
      console.log(`✓ ${file}: valid pack "${result.pack.id}" v${result.pack.version}`);
      for (const dialogue of result.pack.dialogues ?? []) {
        console.log(`\n${renderBranchMap(dialogue)}`);
      }
      printScenarioReports(result.pack);
      printExamReports(result.pack);
      printReferenceReports(result.pack);
      if (result.pack.course) {
        console.log(`\n${renderCourseReport(result.pack)}`);
        const live = courseManifestIssues(
          result.pack,
          existsSync(manifestPath) ? manifestPath : undefined,
          (id) => readPublishedPack(manifestPath, id),
        );
        console.log(live.lines.join('\n'));
      }
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

/**
 * T26 cost gate: print what the run would send to ElevenLabs and require an
 * explicit go-ahead. `--yes` skips the prompt; a non-interactive run without
 * it fails before ANY provider call.
 */
async function confirmAudioRun(plan: AudioRunPlan, yes: boolean): Promise<void> {
  const parts = [
    plan.storyTracks > 0 ? `${plan.storyTracks} story track(s)` : null,
    plan.dialogueNodes > 0 ? `${plan.dialogueNodes} dialogue node(s)` : null,
    plan.dialogueChoices > 0 ? `${plan.dialogueChoices} choice coach render(s)` : null,
    plan.scenarioLines > 0 ? `${plan.scenarioLines} scenario line(s)` : null,
    plan.scenarioCoach > 0 ? `${plan.scenarioCoach} scenario coach render(s)` : null,
  ].filter((p): p is string => p !== null);
  console.log(
    `Pre-render summary: ${parts.join(', ') || 'nothing'} — ` +
      `${plan.requests} ElevenLabs request(s), ~${plan.chars} characters.`,
  );
  // Per-track resolution (M14): the register-resolved voice/style and the
  // model/language each request will carry — readable before anything fires.
  for (const t of plan.tracks) {
    const lang = t.languageCode === undefined ? '' : `, language_code ${t.languageCode}`;
    console.log(
      `  ${t.storyId}/${t.trackId}: model ${t.model}${lang}, voice ${t.voice}, style ${t.style} — ` +
        `${t.requests} request(s), ~${t.chars} chars`,
    );
  }
  if (plan.requests === 0) fail('nothing to render — check the filters', 2);
  if (yes) return;
  if (!process.stdin.isTTY) {
    fail('refusing to render without confirmation — re-run with --yes (non-interactive)', 2);
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') fail('aborted — no requests were made', 2);
}

async function audioCommand(args: string[]): Promise<void> {
  const drafts: string[] = [];
  let out: string | undefined;
  let audition = false;
  let takes = 3;
  let model: string | undefined;
  let stories: string[] | undefined;
  let tracks: string[] | undefined;
  let dialogues: string[] | undefined;
  let scenarios: string[] | undefined;
  let playerAudio = false;
  let mouthOnly = false;
  let restampFlag = true;
  let yes = false;
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
      // Track ids ("photo-anton") or dialogue groups ("dinner-mini/mama").
      const kv = /^([a-z0-9-]+(?:\/[a-z0-9-]+)?)=(\d+)$/.exec(v);
      if (kv) seeds[kv[1]!] = Number.parseInt(kv[2]!, 10);
      else if (/^\d+$/.test(v)) defaultSeed = Number.parseInt(v, 10);
      else
        fail(
          `--seed expects <n>, <track-id>=<n>, or <dialogueId>/<characterId>=<n>, got "${v}"`,
          2,
        );
    } else if (arg === '--stories') stories = next().split(',').filter(Boolean);
    else if (arg === '--tracks') tracks = next().split(',').filter(Boolean);
    else if (arg === '--dialogues') dialogues = next().split(',').filter(Boolean);
    else if (arg === '--scenarios') scenarios = next().split(',').filter(Boolean);
    else if (arg === '--player-audio') playerAudio = true;
    else if (arg === '--mouth-only') mouthOnly = true;
    else if (arg === '--no-restamp') restampFlag = false;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--model') model = next();
    else if (arg === '--extras') extras = next();
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else drafts.push(arg);
  }
  if (out === undefined) fail(`audio needs -o <pack-dir>\n\n${USAGE}`, 2);
  if (mouthOnly) {
    // No drafts, no client, no cost gate: the pack on disk is the input.
    try {
      const summary = runMouthOnly(out, { scenarios });
      const changed = summary.reports.filter((r) => r.changed).length;
      console.log(
        `✓ ${summary.pack.id} v${summary.pack.version} → ${summary.outFile} — ` +
          `${summary.reports.length} mouth track(s) recomputed, ${changed} changed`,
      );
      for (const r of summary.reports) {
        console.log(
          `  ${r.scenarioId}/${r.sentenceId ?? r.file.split('/').pop()}: ` +
            `${(r.durationMs / 1000).toFixed(2)}s → ${r.mouthLength} steps${r.changed ? ' (changed)' : ''}`,
        );
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e), 1);
    }
    return;
  }
  if (drafts.length === 0) fail(`audio needs at least one draft file\n\n${USAGE}`, 2);

  const filters = { stories, tracks, dialogues, scenarios, playerAudio };
  try {
    if (restampFlag && !audition && !mouthOnly) alignerPreflight();
    // Cost gate BEFORE the client exists — an unconfirmed run fires nothing.
    const plan = planAudioRun(drafts, {
      ...filters,
      extrasPath: extras,
      audition,
      takes,
      modelId: model,
    });
    await confirmAudioRun(plan, yes);
  } catch (e) {
    if (e instanceof DraftError) fail(e.issues.map(formatIssue).join('\n'), 1);
    throw e;
  }

  const client = makeClient();
  try {
    if (audition) {
      const result = await runAudition(drafts, out, client, {
        takes,
        ...filters,
        modelId: model,
        extrasPath: extras,
      });
      const total = result.story.length + result.dialogue.length + result.scenario.length;
      console.log(`Rendered ${total} audition take(s) into ${out}/audition/:`);
      for (const t of result.story) {
        console.log(`  ${t.trackId} take ${t.take} (seed ${t.seed}) → ${t.file}`);
        console.log(`      alignment: ${describeStamps(t.stampResult)}`);
      }
      for (const t of result.dialogue) {
        console.log(
          `  ${t.dialogueId}/${t.characterId} take ${t.take} (node ${t.nodeId}, seed ${t.seed}) → ${t.file}`,
        );
        console.log(`      alignment: ${describeStamps(t.stampResult)}`);
      }
      for (const t of result.scenario) {
        console.log(
          `  ${t.scenarioId}/${t.characterId} ${t.variant} take ${t.take} (${t.label}, seed ${t.seed}) → ${t.file}`,
        );
        console.log(`      alignment: ${describeStamps(t.stampResult)}`);
      }
      console.log(
        '\nListen, pick a take per track/character, then finalize with ' +
          '--seed <track-id>=<seed> / --seed <dialogueId>/<characterId>=<seed> / ' +
          '--seed <scenarioId>/<characterId>=<seed>.',
      );
    } else {
      const summary = await runFinalize(drafts, out, client, {
        restamp: restampFlag
          ? pythonAligner({ device: process.env.SUMRAK_ALIGN_DEVICE })
          : undefined,
        seeds,
        defaultSeed,
        ...filters,
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
      for (const r of summary.dialogueReports) {
        const kb = (r.opusBytes / 1024).toFixed(0);
        console.log(
          `  ${r.dialogueId}/${r.label} (${r.characterId}: ${r.voice}, seed ${r.seed}): ` +
            `${(r.durationMs / 1000).toFixed(1)}s, ${kb} KiB opus`,
        );
        console.log(`      stamps: ${describeStamps(r.stampResult)}`);
      }
      for (const r of summary.scenarioReports) {
        const kb = (r.opusBytes / 1024).toFixed(0);
        console.log(
          `  ${r.scenarioId}/${r.label} ${r.variant} (${r.characterId}: ${r.voice}, seed ${r.seed}): ` +
            `${(r.durationMs / 1000).toFixed(1)}s, ${kb} KiB opus, mouth ${r.mouthLength} steps`,
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
  let allowStampRisk = false;
  let skipStampAudit = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = (): string => {
      const v = args[++i];
      if (v === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      return v;
    };
    if (arg === '--allow-stamp-risk') allowStampRisk = true;
    else if (arg === '--skip-stamp-audit') skipStampAudit = true;
    else if (arg === '--content') content = next();
    else if (arg === '--push') push = true;
    else if (arg === '-m' || arg === '--message') message = next();
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else if (packDir === undefined) packDir = arg;
    else fail(`publish takes exactly one <pack-dir>\n\n${USAGE}`, 2);
  }
  if (packDir === undefined) fail(`publish needs a <pack-dir>\n\n${USAGE}`, 2);
  if (content === undefined) fail(`publish needs --content <sumrak-content-dir>\n\n${USAGE}`, 2);

  try {
    const summary = runPublish(packDir, content, {
      push,
      message,
      allowStampRisk,
      ...(skipStampAudit ? {} : { stampAudit: pythonAligner() }),
    });
    if (summary.outcome === 'unchanged') {
      console.log(`= ${summary.packId} v${summary.version} already published, nothing to do`);
      return;
    }
    const mb = (summary.totalBytes / (1024 * 1024)).toFixed(2);
    // scene/ PNG layers are the bulk of a scenario pack (≈ 4–5 MB per family)
    // and the reason the app's sync gate is Wi-Fi-only for them (T58).
    const scene =
      summary.sceneBytes > 0
        ? `, of which scene/ ${(summary.sceneBytes / (1024 * 1024)).toFixed(2)} MB (Wi-Fi-gated PNG layers)`
        : '';
    console.log(
      `✓ published ${summary.packId} v${summary.version} (${summary.files.length} files, ${mb} MB${scene}) — commit ${summary.committed}${summary.pushed ? ', pushed' : ' (not pushed; use --push)'}`,
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

function packFileOf(arg: string): string {
  return arg.endsWith('.json') ? arg : `${arg.replace(/\/$/, '')}/pack.json`;
}

function loadPackFor(arg: string): { pack: Pack; dir: string; file: string } {
  const file = packFileOf(arg);
  const parsed = safeParsePack(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) fail(`${file} is not a valid pack`, 1);
  return { pack: parsed.data, dir: dirname(file), file };
}

function stampAuditCommand(args: string[]): void {
  const targets: string[] = [];
  let track: string | undefined;
  let jsonOut: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--track') track = args[++i];
    else if (arg === '--json') jsonOut = args[++i];
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else targets.push(arg);
  }
  if (targets.length === 0) fail(`stamp-audit needs at least one pack\n\n${USAGE}`, 2);
  const aligner = pythonAligner();
  const audits: PackAudit[] = [];
  try {
    for (const t of targets) {
      const { pack, dir } = loadPackFor(t);
      const audit = auditPack(pack, dir, aligner, { trackId: track });
      audits.push(audit);
      console.log(formatAuditTable(audit));
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e), 1);
  }
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(audits, null, 1)}\n`);
  if (audits.some((a) => !a.ok)) process.exit(1);
}

function restampCommand(args: string[]): void {
  let target: string | undefined;
  let track: string | undefined;
  let outFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--track') track = args[++i];
    else if (arg === '-o' || arg === '--out') outFile = args[++i];
    else if (arg.startsWith('-')) fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    else if (target === undefined) target = arg;
    else fail(`restamp takes exactly one pack\n\n${USAGE}`, 2);
  }
  if (target === undefined) fail(`restamp needs a pack\n\n${USAGE}`, 2);
  try {
    const { pack, dir, file } = loadPackFor(target);
    const { pack: next, tracks } = restampPack(pack, dir, pythonAligner(), { trackId: track });
    writeFileSync(outFile ?? file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`✓ restamped ${tracks.length} track(s) of ${pack.id} → ${outFile ?? file}`);
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
    case 'stamp-audit':
      stampAuditCommand(rest);
      break;
    case 'restamp':
      restampCommand(rest);
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
