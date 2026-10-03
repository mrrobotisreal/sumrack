/**
 * T64 (2026-09-28): MODEL = EL_MODEL ?? eleven_v4 (Mitch's rule; EL_MODEL=eleven_v3 reproduces the v3
 * renders; eleven_v4_turbo is refused). A tags.json value may be a string tag or { tag, production };
 * an `_production` map is also read. Production notes (space / distance / filter / noise) are written to
 * <tags dir>/production.sidecar.json and NEVER sent — the T64 probe proved the API renders none of them
 * (see AUTHORING.md «Eleven v3 / v4 tags» + the v4 production-controls cheat-sheet). A dry run prints the model.
 * CT020 v3 re-voice driver (no pipeline code change): renders every line of
 * Кирилл in `a1-scn-podcast-001` with the voice «Podcast Host, Late Night Talk
 * Show» on eleven_v3, a per-line audio tag from kirill-v3/tags.json, into a
 * separate build tree (kirill-v3/) so the Chris v1 generation stays intact.
 * The coach (River, v2) is carried from the Chris build.
 *
 * Usage: env -u NODE_OPTIONS npx tsx _kirill-v3-render.mts <mode> [ids…]
 *   mode = audition  → MP3 takes of the given ids into kirill-v3/audition/, no pack write
 *   mode = finalize  → every host line → kirill-v3/audio + pack.json (carrying coach from chris-v1)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PackSchema, scenarioLines, type Pack, type Scenario } from '@sumrak/schema';
import { ElevenLabsClient, isTaggedModel } from './src/elevenlabs.ts';
import { resolveEnvVar } from './src/env.ts';
import { renderLine, finalizeLine, RequestPacer, type LineRenderSpec } from './src/line-audio.ts';
import { buildNarrationFromSentences } from './src/narration.ts';
import { mouthTrackForFile } from './src/mouth-track.ts';
import { attachLineAudio, carriedScenarioAudio } from './src/scenario-audio.ts';

const ROOT = '/Users/mitchwintrow/Workspaces/Russian/Stories/_build/a1-scn-podcast-001';
const OUT = join(ROOT, 'kirill-v3');
const VOICE = 'elevenlabs:Podcast Host, Late Night Talk Show';
const MODEL = process.env.EL_MODEL ?? 'eleven_v4';
isTaggedModel(MODEL); // throws on eleven_v4_turbo before anything else runs
const SEED = Number(process.env.KIRILL_SEED ?? 20260928);
type TagEntry = string | { tag: string; production?: string };
const TAGS_FILE = join(OUT, 'tags.json');
const rawTags = JSON.parse(readFileSync(TAGS_FILE, 'utf8')) as Record<string, TagEntry | Record<string, string>>;
const productionMap = (typeof rawTags._production === 'object' ? rawTags._production : {}) as Record<string, string>;
const tagOf = (k: string): string | undefined => { const e = rawTags[k]; return typeof e === 'string' ? e : e && typeof e === 'object' && typeof (e as { tag?: unknown }).tag === 'string' ? (e as { tag: string }).tag : undefined; };
const productionOf = (k: string): string | undefined => { const e = rawTags[k]; return (e && typeof e === 'object' ? (e as { production?: string }).production : undefined) ?? productionMap[k]; };
const [mode, ...ids] = process.argv.slice(2);

const chrisPack = PackSchema.parse(JSON.parse(readFileSync(join(ROOT, 'chris-v1', 'pack.json'), 'utf8'))) as Pack;
const scenario = chrisPack.scenarios![0]!;
const host = scenario.cast.find((c) => c.role === 'host')!;

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
const wanted = ids.length ? items.filter((i) => ids.includes(i.id)) : items;
const chars = wanted.reduce((n, i) => n + i.tag.length + 1 + i.sentence.ru.length, 0);
console.log(`${mode}: ${wanted.length} host line(s) on ${MODEL}, ~${chars} chars incl. tags, seed ${SEED}`);
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

if (mode === 'audition') {
  const dir = join(OUT, 'audition'); mkdirSync(dir, { recursive: true });
  const takes = Number(process.env.TAKES ?? 2);
  for (const i of wanted) for (let t = 1; t <= takes; t++) {
    await pacer.next();
    const seed = t === 1 ? SEED : Math.floor(Math.random() * 2 ** 31);
    const r = await renderLine(client, specOf(i), seed, MODEL);
    const f = join(dir, `kirill--${i.id}--${i.kind}--take${t}--seed${seed}.mp3`);
    writeFileSync(f, r.audio);
    const st = r.stampResultFor(0);
    console.log(`  ${i.id} take ${t} seed ${seed} → ${f}  (${st.stampedTokens}/${st.wordTokens} stamped, trusted=${st.trusted})`);
  }
} else if (mode === 'finalize') {
  const renderDir = join(OUT, 'render'); mkdirSync(renderDir, { recursive: true });
  const lines = new Map<string, import('@sumrak/schema').LineAudio>();
  // carry already-finalized v3 lines (resume support) + everything of the coach from chris-v1
  const prevFile = join(OUT, 'pack.json');
  if (existsSync(prevFile)) {
    const prev = carriedScenarioAudio(PackSchema.parse(JSON.parse(readFileSync(prevFile, 'utf8'))) as Pack, OUT);
    for (const [k, v] of prev.lines) lines.set(k, v);
  }
  const chris = carriedScenarioAudio(chrisPack, join(ROOT, 'chris-v1'));
  for (const [k, v] of chris.coach) {
    const dst = join(OUT, v.file); mkdirSync(dirname(dst), { recursive: true });
    if (!existsSync(dst)) copyFileSync(join(ROOT, 'chris-v1', v.file), dst);
  }
  let n = 0, untrusted: string[] = [], totalMs = 0;
  for (const i of wanted) {
    if (lines.has(i.id) && !process.env.FORCE) { continue; }
    await pacer.next();
    const r = await renderLine(client, specOf(i), SEED, MODEL);
    const done = finalizeLine(r, OUT, i.file, join(renderDir, `${scenario.id}--${i.id}.mp3`));
    const mouth = mouthTrackForFile(join(OUT, i.file), done.durationMs, done.audio.timestamps, i.sentence);
    lines.set(i.id, { ...done.audio, mouth });
    n++; totalMs += done.durationMs;
    if (!done.stampResult.trusted) untrusted.push(i.id);
    console.log(`  ${i.id} (${i.kind}): ${(done.durationMs / 1000).toFixed(1)}s, stamps ${done.stampResult.stampedTokens}/${done.stampResult.wordTokens}${done.stampResult.trusted ? '' : ' UNTRUSTED'}, mouth ${mouth.length}`);
    // write pack.json after every line so a crash resumes
    const stripped: Pack = { ...chrisPack, scenarios: chrisPack.scenarios!.map((s) => ({ ...s, cast: s.cast.map((c) => c.id === host.id ? { ...c, voice: VOICE } : c) })) };
    const bare = JSON.parse(JSON.stringify(stripped)) as Pack;
    for (const ref of scenarioLines(bare.scenarios![0]!)) if (ref.speakerId === host.id) delete (ref.line as { audio?: unknown }).audio;
    const withAudio = attachLineAudio(bare, lines, chris.coach);
    writeFileSync(prevFile, `${JSON.stringify(withAudio, null, 2)}\n`, 'utf8');
  }
  console.log(`rendered ${n} line(s), ${(totalMs / 1000).toFixed(1)}s audio; untrusted stamps: ${untrusted.length} ${untrusted.join(' ')}`);
} else {
  throw new Error('mode = audition | finalize');
}
