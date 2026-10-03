/**
 * T64 (2026-09-28): MODEL = EL_MODEL ?? eleven_v4 (Mitch's rule; EL_MODEL=eleven_v3 reproduces the v3
 * renders; eleven_v4_turbo is refused). A tags.json value may be a string tag or { tag, production };
 * an `_production` map is also read. Production notes (space / distance / filter / noise) are written to
 * <tags dir>/production.sidecar.json and NEVER sent — the T64 probe proved the API renders none of them
 * (see AUTHORING.md «Eleven v3 / v4 tags» + the v4 production-controls cheat-sheet). A dry run prints the model.
 * CT025 render driver (no pipeline code change — sed copy of _gromov-v3-render.mts):
 * renders every host line of Незнакомец in a nightshift scenario pack with
 * Mitch's designed voice «Neznakometz, Unstable Cashier of 24 Hour Russian Convenience Store» on eleven_v4,
 * one per-line expression tag from <build>/neznakometz-v4/tags.json, straight into
 * the build root (audio/ + pack.json). The coach (River, Multilingual v2, no
 * tag, base settings — exactly what `pipeline audio --player-audio` sends) is
 * rendered by the same driver so no host line is ever rendered twice.
 *
 * Usage (from packages/pipeline):
 *   env -u NODE_OPTIONS npx tsx _neznakometz-v4-render.mts <mode> [ids…]
 *   mode = audition  → MP3 takes of the given host ids into <build>/audition/, no pack write
 *   mode = finalize  → every host line (+ every coach line) → audio/ + pack.json (resumable)
 * Env: BUILD=<build dir> (default the A1 nightshift build), NEZ_SEED, RIVER_SEED, TAKES, FORCE, DRY
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PackSchema, scenarioLines, type Pack, type Scenario, type LineAudio } from '@sumrak/schema';
import { ElevenLabsClient, DEFAULT_MODEL_ID, isTaggedModel } from './src/elevenlabs.ts';
import { resolveEnvVar } from './src/env.ts';
import { renderLine, finalizeLine, RequestPacer, type LineRenderSpec } from './src/line-audio.ts';
import { buildNarrationFromSentences } from './src/narration.ts';
import { mouthTrackForFile } from './src/mouth-track.ts';
import { attachLineAudio, carriedScenarioAudio, coachFile, SCENARIO_BASE_SETTINGS } from './src/scenario-audio.ts';

const ROOT = process.env.BUILD ?? '/Users/mitchwintrow/Workspaces/Russian/Stories/_build/a1-scn-nightshift-001';
const TAGS_FILE = join(ROOT, 'neznakometz-v4', 'tags.json');
const SOURCE = join(ROOT, 'pack.annotated.json'); // the annotate output (text source, no audio)
const VOICE = 'elevenlabs:ArHXzPPSKFNaYrb6JndW';
const MODEL = process.env.EL_MODEL ?? 'eleven_v4';
isTaggedModel(MODEL); // throws on eleven_v4_turbo before anything else runs
const SEED = Number(process.env.NEZ_SEED ?? 20260929);
const RIVER_SEED = Number(process.env.RIVER_SEED ?? 399531385);
type TagEntry = string | { tag: string; production?: string };
const rawTags = JSON.parse(readFileSync(TAGS_FILE, 'utf8')) as Record<string, TagEntry | Record<string, string>>;
const productionMap = (typeof rawTags._production === 'object' ? rawTags._production : {}) as Record<string, string>;
const tagOf = (k: string): string | undefined => { const e = rawTags[k]; return typeof e === 'string' ? e : e && typeof e === 'object' && typeof (e as { tag?: unknown }).tag === 'string' ? (e as { tag: string }).tag : undefined; };
const productionOf = (k: string): string | undefined => { const e = rawTags[k]; return (e && typeof e === 'object' ? (e as { production?: string }).production : undefined) ?? productionMap[k]; };
const [mode, ...ids] = process.argv.slice(2);

const source = PackSchema.parse(JSON.parse(readFileSync(SOURCE, 'utf8'))) as Pack;
const scenario = source.scenarios![0]!;
const host = scenario.cast.find((c) => c.role === 'host')!;
const player = scenario.cast.find((c) => c.role === 'player')!;
if (host.voice !== VOICE) throw new Error(`host voice in the draft is ${host.voice}, expected ${VOICE}`);

interface Item { id: string; kind: string; sentence: Scenario['turns'][0]['say'][0]['sentence']; tag: string; production?: string; file: string }
const items: Item[] = [];
for (const ref of scenarioLines(scenario)) {
  if (ref.speakerId !== host.id) continue;
  const id = ref.line.sentence.id;
  const fallbackKey = ref.kind === 'explain' ? '_glossary_explain' : ref.kind === 'howtosay' ? '_glossary_howtosay' : undefined;
  const tag = tagOf(id) ?? (fallbackKey ? tagOf(fallbackKey) : undefined);
  const production = productionOf(id) ?? (fallbackKey ? productionOf(fallbackKey) : undefined);
  if (!tag) throw new Error(`no tag for ${id} (${ref.kind})`);
  items.push({ id, kind: ref.kind, sentence: ref.line.sentence, tag, ...(production !== undefined && { production }), file: `audio/${scenario.id}/${id}.opus` });
}
const coachItems = scenario.turns.filter((t) => t.expect?.accept[0] !== undefined).map((t) => ({ turnId: t.id, text: t.expect!.accept[0]!, file: coachFile(scenario.id, t.id) }));
const wanted = ids.length ? items.filter((i) => ids.includes(i.id)) : items;
const chars = wanted.reduce((n, i) => n + i.tag.length + 1 + i.sentence.ru.length, 0);
const coachChars = coachItems.reduce((n, c) => n + c.text.length, 0);
console.log(`${mode}: ${wanted.length} host line(s) on ${MODEL} (~${chars} chars incl. tags, seed ${SEED})${mode === 'finalize' ? ` + ${coachItems.length} coach line(s) on ${DEFAULT_MODEL_ID} (~${coachChars} chars, seed ${RIVER_SEED})` : ''}`);
const produced = items.filter((i) => i.production !== undefined);
if (produced.length) {
  const sidecar = join(dirname(TAGS_FILE), 'production.sidecar.json');
  writeFileSync(sidecar, `${JSON.stringify({ _note: 'T64: production notes are design intent only — the ElevenLabs API renders no filters / noises / spaces / distances (probe 2026-09-28); apply locally (ffmpeg) or not at all. Never sent.', model: MODEL, lines: Object.fromEntries(produced.map((i) => [i.id, i.production])) }, null, 2)}\n`);
  console.log(`  production notes: ${produced.length} line(s) → ${sidecar} (NOT sent to ElevenLabs — T64 probe (h))`);
}
if (process.env.DRY) process.exit(0);

const client = new ElevenLabsClient(resolveEnvVar('ELEVENLABS_API_KEY', '/Users/mitchwintrow/Workspaces/Russian/Sumrak')!);
const pacer = new RequestPacer();
const specOf = (i: Item): LineRenderSpec => ({
  voice: VOICE, characterId: host.id, narration: buildNarrationFromSentences([i.sentence]), audioTag: i.tag,
});
const coachSpec = (text: string): LineRenderSpec => ({
  voice: player.voice, characterId: player.id, narration: { text, spans: [] }, voiceSettings: { ...SCENARIO_BASE_SETTINGS },
});

if (mode === 'audition') {
  const dir = join(ROOT, 'audition'); mkdirSync(dir, { recursive: true });
  const takes = Number(process.env.TAKES ?? 2);
  for (const i of wanted) for (let t = 1; t <= takes; t++) {
    await pacer.next();
    const seed = t === 1 ? SEED : Math.floor(Math.random() * 2 ** 31);
    const r = await renderLine(client, specOf(i), seed, MODEL);
    const f = join(dir, `neznakometz--${i.id}--${i.kind}--take${t}--seed${seed}.mp3`);
    writeFileSync(f, r.audio);
    const st = r.stampResultFor(0);
    console.log(`  ${i.id} take ${t} seed ${seed} → ${f}  (${st.stampedTokens}/${st.wordTokens} stamped, trusted=${st.trusted})`);
  }
} else if (mode === 'finalize') {
  const renderDir = join(ROOT, 'render'); mkdirSync(renderDir, { recursive: true });
  const lines = new Map<string, LineAudio>();
  const coach = new Map<string, LineAudio>();
  const prevFile = join(ROOT, 'pack.json');
  if (existsSync(prevFile)) {
    // a partially rendered pack fails the all-or-nothing audio invariant, so resume reads it structurally
    const prev = carriedScenarioAudio(JSON.parse(readFileSync(prevFile, 'utf8')) as Pack, ROOT);
    for (const [k, v] of prev.lines) lines.set(k, v);
    for (const [k, v] of prev.coach) coach.set(k, v);
  }
  const write = () => {
    const stripped = JSON.parse(JSON.stringify(source)) as Pack;
    const withAudio = attachLineAudio(stripped, lines, coach);
    writeFileSync(prevFile, `${JSON.stringify(withAudio, null, 2)}\n`, 'utf8');
  };
  let n = 0; const untrusted: string[] = []; let totalMs = 0;
  for (const i of wanted) {
    if (lines.has(i.id) && !process.env.FORCE) continue;
    await pacer.next();
    const r = await renderLine(client, specOf(i), SEED, MODEL);
    const done = finalizeLine(r, ROOT, i.file, join(renderDir, `${scenario.id}--${i.id}.mp3`));
    const mouth = mouthTrackForFile(join(ROOT, i.file), done.durationMs, done.audio.timestamps, i.sentence);
    lines.set(i.id, { ...done.audio, mouth });
    n++; totalMs += done.durationMs;
    if (!done.stampResult.trusted) untrusted.push(i.id);
    console.log(`  ${i.id} (${i.kind}): ${(done.durationMs / 1000).toFixed(1)}s, stamps ${done.stampResult.stampedTokens}/${done.stampResult.wordTokens}${done.stampResult.trusted ? '' : ' UNTRUSTED'}, mouth ${mouth.length}`);
    write();
  }
  let nc = 0;
  if (!ids.length) for (const c of coachItems) {
    const key = `${scenario.id}/${c.turnId}`;
    if (coach.has(key) && !process.env.FORCE) continue;
    await pacer.next();
    const r = await renderLine(client, coachSpec(c.text), RIVER_SEED, DEFAULT_MODEL_ID);
    const done = finalizeLine(r, ROOT, c.file, join(renderDir, `${scenario.id}--${c.turnId}-coach.mp3`));
    const mouth = mouthTrackForFile(join(ROOT, c.file), done.durationMs, undefined, undefined);
    const { timestamps: _drop, ...rest } = done.audio as LineAudio & { timestamps?: unknown };
    coach.set(key, { ...(rest as LineAudio), mouth });
    nc++; totalMs += done.durationMs;
    console.log(`  ${c.turnId}-coach: ${(done.durationMs / 1000).toFixed(1)}s «${c.text}», mouth ${mouth.length}`);
    write();
  }
  console.log(`rendered ${n} host line(s) + ${nc} coach line(s), ${(totalMs / 1000).toFixed(1)}s audio; untrusted stamps: ${untrusted.length} ${untrusted.join(' ')}`);
} else {
  throw new Error('mode = audition | finalize');
}
