import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  safeParsePack,
  WordStampSchema,
  type AudioTrack,
  type NodeAudio,
  type Pack,
  type Sentence,
  type Story,
  type WordStamp,
} from '@sumrak/schema';
import { z } from 'zod';
import { annotateDrafts } from './annotate.ts';
import {
  planDialogueItems,
  runDialogueAudition,
  runDialogueFinalize,
  type DialogueAuditionTake,
  type DialogueTrackReport,
} from './dialogue-audio.ts';
import { sniffDraftKind } from './dialogue-draft.ts';
import { DEFAULT_MODEL_ID, ElevenLabsClient, isV3Model } from './elevenlabs.ts';
import { parseDraft, type ParsedDraft } from './draft.ts';
import { loadExtras } from './extras.ts';
import type { VoiceDirection } from './frontmatter.ts';
import { buildNarrationFromSentences, type NarrationText } from './narration.ts';
import { applyRegister, type ResolvedVoiceDirection } from './registers.ts';
import {
  concatRunsToMp3,
  decodeToWav,
  encodeOpus,
  exciseWav,
  measureLoudness,
  probeDurationMs,
} from './opus.ts';
import {
  alignCharacters,
  mapAlignmentToStamps,
  type CharAlignment,
  type StampResult,
} from './stamps.ts';

/**
 * `pipeline audio` (T09, design §8 step 3): drafts → rendered narration.
 *
 * Two modes:
 * - **audition**: render N candidate takes per story × voice direction as
 *   MP3s into `<packDir>/audition/` for human review. Never touches the pack.
 * - **finalize**: render one take per direction (seed chosen from the
 *   audition), encode to Opus in `<packDir>/audio/`, map word stamps, attach
 *   `AudioTrack`s, and write the validated `pack.json`.
 *
 * Finalize merges with an existing `pack.json` in the out dir, so tracks can
 * be rendered story-by-story across runs (`--stories` / `--tracks` filters).
 */

export interface AudioFilters {
  /** Only render these story ids (all when absent). */
  stories?: string[];
  /** Only render these track ids (all when absent). */
  tracks?: string[];
  /** Only render these dialogue ids (all when absent) — T26. */
  dialogues?: string[];
  /** Render coach audio for choices + scripted player lines — T26. */
  playerAudio?: boolean;
}

export interface AuditionOptions extends AudioFilters {
  /** Candidate takes per direction. */
  takes: number;
  modelId?: string;
  /** Pack extras file (lesson/prompts/exercises — course-unit packs, T17). */
  extrasPath?: string;
}

export interface FinalizeOptions extends AudioFilters {
  /** Chosen seed per track id (from the audition), or one seed for all. */
  seeds?: Record<string, number>;
  defaultSeed?: number;
  modelId?: string;
  /** Pack extras file (lesson/prompts/exercises — course-unit packs, T17). */
  extrasPath?: string;
}

export interface TrackReport {
  storyId: string;
  trackId: string;
  voice: string;
  style: string;
  seed: number;
  durationMs: number;
  opusBytes: number;
  stampResult: StampResult;
}

export interface AuditionTake {
  storyId: string;
  trackId: string;
  take: number;
  seed: number;
  file: string;
  /** Alignment quality of this take (a bad-alignment take is a red flag). */
  stampResult: StampResult;
}

interface StoryPlan {
  story: Story;
  /** Register-resolved directions (M14): `voice`/`style` always present. */
  directions: ResolvedVoiceDirection[];
  /** Directory of the story's draft file — `sentenceAudio` clip paths resolve against it. */
  draftDir: string;
}

/**
 * Story × direction plan. Registers are resolved HERE, once: the pack's
 * `category` (draft `pack:` frontmatter → `assemblePack` → `pack.category`)
 * supplies the default register for directions that name none, and every
 * consumer below — track ids, provider voice, the `AudioTrack.voice`/`style`
 * written to pack.json — sees the resolved values.
 */
function planStories(
  pack: Pack,
  drafts: readonly ParsedDraft[],
  filters: AudioFilters,
): StoryPlan[] {
  const byStory = new Map(
    drafts.map((d) => [
      d.frontmatter.story.id,
      {
        directions: (d.frontmatter.voice ?? []).map((v) => applyRegister(v, pack.category)),
        draftDir: dirname(resolve(d.file)),
      },
    ]),
  );
  const plans: StoryPlan[] = [];
  for (const story of pack.stories) {
    if (filters.stories && !filters.stories.includes(story.id)) continue;
    const entry = byStory.get(story.id);
    const all = entry?.directions ?? [];
    const directions = filters.tracks ? all.filter((v) => filters.tracks!.includes(v.id)) : all;
    if (directions.length > 0) {
      plans.push({ story, directions, draftDir: entry?.draftDir ?? process.cwd() });
    }
  }
  return plans;
}

function parseAll(
  draftPaths: readonly string[],
  extrasPath?: string,
): { drafts: ParsedDraft[]; pack: Pack } {
  const files = draftPaths.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
  // Voice directions live on STORY drafts only; dialogue drafts (T26) carry
  // their voices on characters and are handled by planDialogueItems.
  const drafts = files
    .filter((f) => sniffDraftKind(f.path, f.source) === 'story')
    .map((f) => parseDraft(f.path, f.source));
  const pack = annotateDrafts(files, extrasPath === undefined ? undefined : loadExtras(extrasPath));
  return { drafts, pack };
}

function providerVoiceName(direction: ResolvedVoiceDirection, voice = direction.voice): string {
  const [provider, ...rest] = voice.split(':');
  if (provider !== 'elevenlabs' || rest.length === 0) {
    throw new Error(
      `track "${direction.id}": unsupported voice "${voice}" — only "elevenlabs:<name>" is implemented`,
    );
  }
  return rest.join(':');
}

/**
 * Insert `insert` into the narration text at character offset `at` (always a
 * token boundary), shifting every span at or after it by the inserted length.
 * The inserted characters belong to no token, so they are never stamped.
 */
function insertNarrationText(narration: NarrationText, at: number, insert: string): NarrationText {
  if (insert.length === 0) return narration;
  return {
    text: narration.text.slice(0, at) + insert + narration.text.slice(at),
    spans: narration.spans.map((s) =>
      s.start >= at ? { ...s, start: s.start + insert.length, end: s.end + insert.length } : s,
    ),
  };
}

/**
 * Apply the direction's v3 steering to a narration: the leading `audioTag`
 * prefix on the whole text, and (CT011 Tier 2) each `audioCues` entry right
 * before its sentence — i.e. immediately after that sentence's `\n\n`
 * separator. v3 rejects previous_text, so tags in the text are the steering
 * channel there; both are dropped for non-v3 models (the text is unchanged).
 * Cue ids are validated against the story regardless of model: a cue keyed
 * to a sentence that is not in the story is an authoring error, never a
 * silent skip.
 */
export function steerNarration(
  base: NarrationText,
  direction: Pick<VoiceDirection, 'id' | 'audioTag' | 'audioCues' | 'contextCues'>,
  v3: boolean,
): NarrationText {
  const cues = Object.entries(direction.audioCues ?? {});
  const contexts = Object.entries(direction.contextCues ?? {});
  const firstSpanOf = new Map<string, number>();
  for (const s of base.spans)
    if (!firstSpanOf.has(s.sentenceId)) firstSpanOf.set(s.sentenceId, s.start);
  for (const [field, entries] of [
    ['audioCues', cues],
    ['contextCues', contexts],
  ] as const) {
    const unknown = entries.filter(([id]) => !firstSpanOf.has(id)).map(([id]) => id);
    if (unknown.length > 0) {
      throw new Error(
        `track "${direction.id}": ${field} reference sentence id(s) not in this story: ${unknown.join(', ')}`,
      );
    }
  }
  let narration = base;
  // Context narration (any model): rendered around its sentence, then cut
  // out of the audio. A `{}` in the text stands for the sentence — text
  // before it is spoken before the sentence, text after it right after (an
  // attribution such as «— шепчет он.»); without `{}` the whole text leads.
  // Later insertion points first, so earlier offsets stay valid; the
  // recorded cut ranges shift with every later insertion.
  const lastSpanOf = new Map<string, number>();
  for (const s of base.spans) lastSpanOf.set(s.sentenceId, s.end);
  const inserts: { at: number; text: string }[] = [];
  for (const [id, raw] of contexts) {
    const [lead = '', trail = ''] = raw.includes('{}') ? raw.split('{}', 2) : [raw, ''];
    if (lead.trim()) inserts.push({ at: firstSpanOf.get(id)!, text: `${lead.trim()} ` });
    if (trail.trim()) inserts.push({ at: lastSpanOf.get(id)!, text: ` ${trail.trim()}` });
  }
  const cuts: { start: number; end: number }[] = [];
  for (const { at, text } of inserts.sort((a, b) => b.at - a.at)) {
    narration = insertNarrationText(narration, at, text);
    for (const c of cuts) if (c.start >= at) ((c.start += text.length), (c.end += text.length));
    cuts.push({ start: at, end: at + text.length });
  }
  if (!v3)
    return cuts.length > 0
      ? { ...narration, cuts: cuts.sort((a, b) => a.start - b.start) }
      : narration;
  const shiftCuts = (at: number, len: number) => {
    for (const c of cuts) if (c.start >= at) ((c.start += len), (c.end += len));
  };
  const ordered = cues
    .map(([id, tags]) => ({ at: firstSpanOf.get(id)!, tags }))
    .sort((a, b) => b.at - a.at);
  for (const { at, tags } of ordered) {
    // The tag goes before the context text (which sits at the same offset).
    narration = insertNarrationText(narration, at, `${tags} `);
    shiftCuts(at, tags.length + 1);
  }
  if (direction.audioTag) {
    narration = insertNarrationText(narration, 0, `${direction.audioTag} `);
    shiftCuts(0, direction.audioTag.length + 1);
  }
  return cuts.length > 0
    ? { ...narration, cuts: cuts.sort((a, b) => a.start - b.start) }
    : narration;
}

/** One same-voice stretch of a story's sentences, with its steered narration text. */
export interface NarrationRun {
  /** Provider-prefixed voice this run renders with (`file:<path>` for a pre-rendered clip). */
  voice: string;
  /** True for a `sentenceVoices` / `sentenceAudio` override run (renders without the narrator `audioTag`). */
  override: boolean;
  /** Absolute path of a pre-rendered clip that IS this run's audio (no provider request). */
  audioFile?: string;
  sentences: Sentence[];
  narration: NarrationText;
}

/**
 * Split a story into consecutive same-voice runs (CT011 `sentenceVoices`).
 * Without overrides there is exactly one run — the whole story in the
 * direction's voice, steered by `audioTag` + `audioCues`. Override runs keep
 * only the cues keyed to their own sentences and get no narrator tag. Every
 * `sentenceVoices` / `audioCues` id must exist in the story.
 */
export function planNarrationRuns(
  story: Story,
  direction: ResolvedVoiceDirection,
  v3: boolean,
  draftDir: string = process.cwd(),
): NarrationRun[] {
  const ids = new Set(story.sentences.map((s) => s.id));
  const overrides = direction.sentenceVoices ?? {};
  const clips = direction.sentenceAudio ?? {};
  for (const [field, map] of [
    ['sentenceVoices', overrides],
    ['sentenceAudio', clips],
  ] as const) {
    const unknown = Object.keys(map).filter((id) => !ids.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `track "${direction.id}": ${field} reference sentence id(s) not in this story: ${unknown.join(', ')}`,
      );
    }
  }
  const both = Object.keys(clips).filter((id) => id in overrides);
  if (both.length > 0) {
    throw new Error(
      `track "${direction.id}": sentence id(s) carry both sentenceVoices and sentenceAudio: ${both.join(', ')}`,
    );
  }
  // Validate every cue against the whole story up front (a cue on an override
  // sentence is legal — it steers that run).
  steerNarration(buildNarrationFromSentences(story.sentences), direction, false);

  const groups: { voice: string; override: boolean; audioFile?: string; sentences: Sentence[] }[] =
    [];
  for (const sentence of story.sentences) {
    const clip = clips[sentence.id];
    if (clip !== undefined) {
      // A pre-rendered clip is always its own run — never merged.
      const audioFile = resolve(draftDir, clip);
      groups.push({ voice: `file:${clip}`, override: true, audioFile, sentences: [sentence] });
      continue;
    }
    const voice = overrides[sentence.id] ?? direction.voice;
    const override = voice !== direction.voice;
    const last = groups.at(-1);
    if (last && last.voice === voice && last.override === override && !last.audioFile)
      last.sentences.push(sentence);
    else groups.push({ voice, override, sentences: [sentence] });
  }
  const cues = direction.audioCues ?? {};
  const contexts = direction.contextCues ?? {};
  return groups.map((g) => {
    const own = new Set(g.sentences.map((s) => s.id));
    const runCues = Object.fromEntries(Object.entries(cues).filter(([id]) => own.has(id)));
    const runContexts = Object.fromEntries(Object.entries(contexts).filter(([id]) => own.has(id)));
    const narration = steerNarration(
      buildNarrationFromSentences(g.sentences),
      {
        id: direction.id,
        audioTag: g.override ? undefined : direction.audioTag,
        audioCues: g.audioFile ? {} : runCues,
        contextCues: g.audioFile ? {} : runContexts,
      },
      v3,
    );
    return {
      voice: g.voice,
      override: g.override,
      ...(g.audioFile !== undefined && { audioFile: g.audioFile }),
      sentences: g.sentences,
      narration,
    };
  });
}

/** Sibling stamp file of a pre-rendered clip: WordStamp[] relative to the clip start. */
const ClipStampsSchema = z.array(WordStampSchema);

/**
 * Word stamps for a pre-rendered clip run: read from `<clip>.stamps.json`
 * when present (validated, sorted, clamped to the clip), else an empty but
 * still-trusted result — a stampless clip must not wipe the whole track's
 * stamps the way an untrusted provider alignment does.
 */
function clipStamps(run: NarrationRun, clipDurationMs: number): StampResult {
  const wordTokens = run.narration.spans.filter((s) => !s.isPunct).length;
  const stampsFile = `${run.audioFile!}.stamps.json`;
  if (!existsSync(stampsFile)) {
    return {
      stamps: [],
      trusted: true,
      wordTokens,
      stampedTokens: 0,
      coverage: wordTokens === 0 ? 1 : 0,
      matchedCharRatio: 1,
      issues: [`pre-rendered clip ${run.voice} has no ${stampsFile.split('/').pop()} — unstamped`],
    };
  }
  const parsed = ClipStampsSchema.safeParse(JSON.parse(readFileSync(stampsFile, 'utf8')));
  if (!parsed.success)
    throw new Error(`${stampsFile} is not a WordStamp[]: ${parsed.error.message}`);
  const own = new Set(run.sentences.map((s) => s.id));
  const foreign = parsed.data.filter((st) => !own.has(st.sentenceId)).map((st) => st.sentenceId);
  if (foreign.length > 0) {
    throw new Error(
      `${stampsFile} stamps sentence id(s) outside the clip's run: ${[...new Set(foreign)].join(', ')}`,
    );
  }
  const stamps = parsed.data
    .map((st) => ({ ...st, endMs: Math.min(st.endMs, clipDurationMs) }))
    .filter((st) => st.startMs < clipDurationMs && st.endMs > st.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  return {
    stamps,
    trusted: true,
    wordTokens,
    stampedTokens: stamps.length,
    coverage: wordTokens === 0 ? 1 : stamps.length / wordTokens,
    matchedCharRatio: 1,
    issues: [`pre-rendered clip ${run.voice} spliced with ${stamps.length} carried stamps`],
  };
}

/** Never cut closer than this to the first word of the cued sentence. */
const CUT_GUARD_MS = 40;

/**
 * Locate each `contextCues` cut in the rendered audio via the provider's
 * character alignment: from the first context character's start to just
 * before the cued sentence's first character (never before the context's own
 * last character ends). Returns `[startMs, endMs)` ranges in run time.
 */
export function locateCuts(
  narration: NarrationText,
  alignment: CharAlignment,
): { startMs: number; endMs: number }[] {
  const cuts = narration.cuts ?? [];
  if (cuts.length === 0) return [];
  const charMap = alignCharacters(narration.text, alignment.characters);
  // UTF-16 offset → code-point index (the alignment is per code point).
  const utf16ToCp = new Int32Array(narration.text.length + 1).fill(-1);
  {
    let cp = 0;
    let u = 0;
    for (const ch of Array.from(narration.text)) {
      utf16ToCp[u] = cp;
      if (ch.length === 2) utf16ToCp[u + 1] = cp;
      u += ch.length;
      cp++;
    }
    utf16ToCp[u] = cp;
  }
  const timeOf = (from: number, to: number): { start: number; end: number } | null => {
    let start = Infinity;
    let end = -Infinity;
    for (let u = from; u < to; u++) {
      const p = charMap[utf16ToCp[u]!]!;
      if (p === -1) continue;
      start = Math.min(start, alignment.startSeconds[p]!);
      end = Math.max(end, alignment.endSeconds[p]!);
    }
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  };
  const out: { startMs: number; endMs: number }[] = [];
  for (const cut of cuts) {
    const ctx = timeOf(cut.start, cut.end);
    if (!ctx) throw new Error('context cue text was not found in the provider alignment');
    let startMs = Math.round(ctx.start * 1000);
    let endMs = Math.round(ctx.end * 1000);
    // Leading context: the cued sentence's first token follows immediately —
    // cut up to (a guard before) its first sound. Trailing context: the
    // sentence's last token precedes it — never cut into that token's tail.
    const nextSpan = narration.spans.find((s) => s.start === cut.end);
    if (nextSpan) {
      const next = timeOf(nextSpan.start, nextSpan.end);
      if (next) endMs = Math.max(endMs, Math.round(next.start * 1000) - CUT_GUARD_MS);
    }
    const prevSpan = [...narration.spans].reverse().find((s) => s.end === cut.start);
    if (prevSpan) {
      const prev = timeOf(prevSpan.start, prevSpan.end);
      if (prev) startMs = Math.max(startMs, Math.round(prev.end * 1000));
    }
    if (endMs > startMs) out.push({ startMs, endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Shift stamps past each cut back by the cut's length; drop any inside a cut. */
export function applyCutsToStamps(
  result: StampResult,
  cuts: readonly { startMs: number; endMs: number }[],
  newDurationMs: number,
): StampResult {
  if (cuts.length === 0 || !result.trusted) return result;
  const stamps: WordStamp[] = [];
  let dropped = 0;
  for (const st of result.stamps) {
    let shift = 0;
    let inside = false;
    for (const c of cuts) {
      if (st.startMs >= c.endMs) shift += c.endMs - c.startMs;
      else if (st.endMs > c.startMs) inside = true;
    }
    if (inside) {
      dropped++;
      continue;
    }
    const startMs = st.startMs - shift;
    const endMs = Math.min(st.endMs - shift, newDurationMs);
    if (startMs >= newDurationMs || endMs <= startMs) {
      dropped++;
      continue;
    }
    stamps.push({ ...st, startMs, endMs });
  }
  const issues = [...result.issues, `${cuts.length} context cue(s) cut out`];
  if (dropped > 0) issues.push(`${dropped} stamp(s) fell inside a context cut and were dropped`);
  return {
    ...result,
    stamps,
    stampedTokens: stamps.length,
    coverage: result.wordTokens === 0 ? 1 : stamps.length / result.wordTokens,
    issues,
  };
}

/** Never boost a run into clipping when level-matching. */
const LEVEL_MATCH_PEAK_CEILING_DB = -1;

async function renderDirection(
  client: ElevenLabsClient,
  story: Story,
  direction: ResolvedVoiceDirection,
  seed: number,
  modelId: string | undefined,
  draftDir: string = process.cwd(),
): Promise<{ audio: Buffer; stampResultFor: (durationMs: number) => StampResult }> {
  // Per-direction model beats the CLI --model, which beats the default (v2).
  const model = direction.model ?? modelId ?? DEFAULT_MODEL_ID;
  const v3 = isV3Model(model);
  // v3 rejects previous_text; mood steering there is the leading audio tag
  // plus any per-sentence cues. Tags become part of the rendered text, so
  // every token span shifts by the inserted length — stamp mapping stays
  // exact, and the tags' own characters (near-silent in the alignment) are
  // never stamped. On non-v3 models the tags are simply not applied (plain
  // text renders). Context cues (any model) are rendered and then cut out.
  // `language_code` (default ru) and speaker boost (default on) are filled
  // in by the client for non-v3 requests.
  const runs = planNarrationRuns(story, direction, v3, draftDir);
  const rendered: {
    run: NarrationRun;
    result: { audio: Buffer; alignment: CharAlignment | null } | null;
  }[] = [];
  for (const run of runs) {
    if (run.audioFile) {
      if (!existsSync(run.audioFile)) {
        throw new Error(`track "${direction.id}": sentenceAudio clip not found: ${run.audioFile}`);
      }
      rendered.push({ run, result: null });
      continue;
    }
    const voiceId = await client.resolveVoiceId(providerVoiceName(direction, run.voice));
    const result = await client.renderWithTimestamps({
      voiceId,
      text: run.narration.text,
      modelId: model,
      seed,
      ...(v3 || run.override ? {} : { previousText: direction.stylePrompt }),
      ...(direction.language !== undefined && { languageCode: direction.language }),
      voiceSettings: direction.settings,
    });
    rendered.push({ run, result });
  }

  const stampsOf = (
    narration: NarrationText,
    alignment: { characters: string[]; startSeconds: number[]; endSeconds: number[] } | null,
    durationMs: number,
  ): StampResult =>
    alignment
      ? mapAlignmentToStamps(narration, alignment, durationMs)
      : {
          stamps: [],
          trusted: false,
          wordTokens: narration.spans.filter((s) => !s.isPunct).length,
          stampedTokens: 0,
          coverage: 0,
          matchedCharRatio: 0,
          issues: ['provider returned no character alignment'],
        };

  const needsEditing = rendered.some(
    (r) => r.run.audioFile !== undefined || (r.run.narration.cuts?.length ?? 0) > 0,
  );
  if (rendered.length === 1 && !needsEditing) {
    const only = rendered[0]!;
    return {
      audio: only.result!.audio,
      stampResultFor: (durationMs) =>
        stampsOf(only.run.narration, only.result!.alignment, durationMs),
    };
  }

  // Several voices, pre-rendered clips, or context cuts: edit the per-run
  // audio into ONE track (CT011 §5.4). Decode each run to PCM (exact, gap-free
  // durations), cut out any context narration, level-match override runs to
  // the narrator runs' mean level, concatenate sample-accurately, and offset
  // every run's stamps by the accumulated duration of the runs before it so
  // word stamps stay exact across each seam.
  const work = mkdtempSync(join(tmpdir(), 'sumrak-runs-'));
  try {
    const parts = rendered.map(({ run, result }, i) => {
      const wav = join(work, `run${i}.wav`);
      if (run.audioFile) {
        decodeToWav(run.audioFile, wav);
        const durationMs = probeDurationMs(wav);
        return {
          run,
          wav,
          durationMs,
          level: measureLoudness(wav),
          stamps: clipStamps(run, durationMs),
        };
      }
      const mp3 = join(work, `run${i}.mp3`);
      writeFileSync(mp3, result!.audio);
      const raw = join(work, `run${i}.raw.wav`);
      decodeToWav(mp3, raw);
      const rawDurationMs = probeDurationMs(raw);
      let stamps = stampsOf(run.narration, result!.alignment, rawDurationMs);
      if ((run.narration.cuts?.length ?? 0) > 0) {
        if (!result!.alignment) {
          throw new Error(
            `track "${direction.id}": context cues need the provider alignment to cut, but none came back`,
          );
        }
        const cuts = locateCuts(run.narration, result!.alignment);
        exciseWav(raw, wav, cuts);
        const durationMs = probeDurationMs(wav);
        stamps = applyCutsToStamps(stamps, cuts, durationMs);
        return { run, wav, durationMs, level: measureLoudness(wav), stamps };
      }
      return { run, wav: raw, durationMs: rawDurationMs, level: measureLoudness(raw), stamps };
    });
    const narratorLevels = parts.filter((p) => !p.run.override).map((p) => p.level.meanDb);
    const reference =
      narratorLevels.length > 0
        ? narratorLevels.reduce((a, b) => a + b, 0) / narratorLevels.length
        : parts[0]!.level.meanDb;
    const gains = parts.map((p) => {
      if (!p.run.override) return 0;
      const wanted = reference - p.level.meanDb;
      return Math.min(wanted, LEVEL_MATCH_PEAK_CEILING_DB - p.level.maxDb);
    });
    const outMp3 = join(work, 'track.mp3');
    concatRunsToMp3(
      parts.map((p, i) => ({ file: p.wav, gainDb: gains[i]! })),
      outMp3,
    );
    const audio = readFileSync(outMp3);
    const levelNotes = parts
      .map((p, i) =>
        p.run.override
          ? `run ${i + 1} (${p.run.voice}) level-matched ${gains[i]! >= 0 ? '+' : ''}${gains[i]!.toFixed(1)} dB`
          : null,
      )
      .filter((n): n is string => n !== null);

    // Each run's stamps are already relative to its own (edited) audio.
    const runStamps = parts.map((p) => ({
      run: p.run,
      durationMs: p.durationMs,
      result: p.stamps,
    }));
    return {
      audio,
      stampResultFor: (totalMs) => {
        const stamps: StampResult['stamps'] = [];
        const issues: string[] = [...levelNotes];
        let offset = 0;
        let wordTokens = 0;
        let stampedTokens = 0;
        let matchedCharRatio = 1;
        let trusted = true;
        for (const { run, durationMs, result } of runStamps) {
          wordTokens += result.wordTokens;
          stampedTokens += result.stampedTokens;
          matchedCharRatio = Math.min(matchedCharRatio, result.matchedCharRatio);
          if (!result.trusted) {
            trusted = false;
            issues.push(`run ${run.voice}: ${result.issues.join('; ')}`);
          } else {
            issues.push(...result.issues);
            for (const st of result.stamps) {
              const startMs = st.startMs + offset;
              const endMs = Math.min(st.endMs + offset, totalMs);
              if (startMs >= totalMs || endMs <= startMs) continue;
              stamps.push({ ...st, startMs, endMs });
            }
          }
          offset += durationMs;
        }
        // Seams are monotonic by construction (each run's stamps are clamped
        // to its own duration); assert it anyway — never ship a bad splice.
        for (let i = 1; i < stamps.length; i++) {
          if (stamps[i]!.startMs < stamps[i - 1]!.endMs) {
            trusted = false;
            issues.push('stamps overlap across a voice seam — dropping all stamps for this track');
            break;
          }
        }
        return {
          stamps: trusted ? stamps : [],
          trusted,
          wordTokens,
          stampedTokens: trusted ? stampedTokens : 0,
          coverage: wordTokens === 0 ? 1 : (trusted ? stampedTokens : 0) / wordTokens,
          matchedCharRatio,
          issues,
        };
      },
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function newSeed(): number {
  return randomInt(0, 2 ** 31);
}

export interface AuditionResult {
  story: AuditionTake[];
  dialogue: DialogueAuditionTake[];
}

/** Render candidate takes for review. Writes MP3s, never touches pack.json. */
export async function runAudition(
  draftPaths: readonly string[],
  outDir: string,
  client: ElevenLabsClient,
  opts: AuditionOptions,
): Promise<AuditionResult> {
  const { drafts, pack } = parseAll(draftPaths, opts.extrasPath);
  const plans = planStories(pack, drafts, opts);
  const dialogueItems = planDialogueItems(pack, opts);
  if (plans.length === 0 && dialogueItems.length === 0) {
    throw new Error('no stories with voice directions (and no dialogues) matched the filters');
  }

  const auditionDir = join(outDir, 'audition');
  mkdirSync(auditionDir, { recursive: true });
  const takes: AuditionTake[] = [];

  for (const { story, directions, draftDir } of plans) {
    for (const direction of directions) {
      for (let take = 1; take <= opts.takes; take++) {
        const seed = newSeed();
        const rendered = await renderDirection(
          client,
          story,
          direction,
          seed,
          opts.modelId,
          draftDir,
        );
        const file = join(auditionDir, `${direction.id}--take${take}--seed${seed}.mp3`);
        writeFileSync(file, rendered.audio);
        // MP3 duration ≈ Opus duration; probing the MP3 is close enough for
        // an audition-time alignment sanity check.
        const stampResult = rendered.stampResultFor(probeDurationMs(file));
        takes.push({ storyId: story.id, trackId: direction.id, take, seed, file, stampResult });
      }
    }
  }

  const dialogueTakes =
    dialogueItems.length > 0
      ? await runDialogueAudition(client, dialogueItems, outDir, {
          takes: opts.takes,
          modelId: opts.modelId,
          newSeed,
        })
      : [];
  return { story: takes, dialogue: dialogueTakes };
}

export interface AudioSummary {
  pack: Pack;
  outFile: string;
  reports: TrackReport[];
  dialogueReports: DialogueTrackReport[];
}

/**
 * Previously rendered dialogue audio to carry over (node-by-node workflow —
 * the T09 merge pattern at node granularity): sentenceId → NodeAudio, only
 * for files that still exist in the out dir.
 */
function carriedDialogueAudio(prev: Pack, outDir: string): Map<string, NodeAudio> {
  const carried = new Map<string, NodeAudio>();
  const keep = (sentenceId: string, audio: NodeAudio | undefined) => {
    if (audio && existsSync(join(outDir, audio.file))) carried.set(sentenceId, audio);
  };
  for (const dialogue of prev.dialogues ?? []) {
    for (const node of dialogue.nodes) {
      keep(node.sentence.id, node.audio);
      for (const choice of node.choices ?? []) keep(choice.sentence.id, choice.audio);
    }
  }
  return carried;
}

/** Attach carried NodeAudio onto a freshly annotated pack's dialogues. */
function applyCarriedDialogueAudio(pack: Pack, carried: Map<string, NodeAudio>): Pack {
  if (carried.size === 0 || !pack.dialogues) return pack;
  return {
    ...pack,
    dialogues: pack.dialogues.map((dialogue) => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => {
        const next = { ...node };
        const nodeAudio = carried.get(node.sentence.id);
        if (nodeAudio) next.audio = nodeAudio;
        if (node.choices) {
          next.choices = node.choices.map((choice) => {
            const choiceAudio = carried.get(choice.sentence.id);
            return choiceAudio ? { ...choice, audio: choiceAudio } : choice;
          });
        }
        return next;
      }),
    })),
  };
}

/** Render final takes, encode Opus, map stamps, and write pack.json. */
export async function runFinalize(
  draftPaths: readonly string[],
  outDir: string,
  client: ElevenLabsClient,
  opts: FinalizeOptions,
): Promise<AudioSummary> {
  const { drafts, pack } = parseAll(draftPaths, opts.extrasPath);
  const plans = planStories(pack, drafts, opts);
  const dialogueItems = planDialogueItems(pack, opts);
  if (plans.length === 0 && dialogueItems.length === 0) {
    throw new Error('no stories with voice directions (and no dialogues) matched the filters');
  }

  // Carry over previously rendered tracks (story-by-story workflow).
  const packFile = join(outDir, 'pack.json');
  const existingAudio = new Map<string, AudioTrack[]>();
  let carriedNodeAudio = new Map<string, NodeAudio>();
  if (existsSync(packFile)) {
    const prev = safeParsePack(JSON.parse(readFileSync(packFile, 'utf8')));
    if (prev.success) {
      for (const story of prev.data.stories) existingAudio.set(story.id, story.audio);
      carriedNodeAudio = carriedDialogueAudio(prev.data, outDir);
    }
  }

  const audioDir = join(outDir, 'audio');
  const renderDir = join(outDir, 'render');
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(renderDir, { recursive: true });

  const reports: TrackReport[] = [];
  const renderedByStory = new Map<string, AudioTrack[]>();

  for (const { story, directions, draftDir } of plans) {
    const tracks: AudioTrack[] = [];
    for (const direction of directions) {
      const seed = opts.seeds?.[direction.id] ?? opts.defaultSeed ?? newSeed();
      const rendered = await renderDirection(
        client,
        story,
        direction,
        seed,
        opts.modelId,
        draftDir,
      );
      const mp3File = join(renderDir, `${direction.id}.mp3`);
      writeFileSync(mp3File, rendered.audio);
      const opusRelPath = `audio/${direction.id}.opus`;
      const opusFile = join(outDir, opusRelPath);
      encodeOpus(mp3File, opusFile);
      const durationMs = probeDurationMs(opusFile);
      const stampResult = rendered.stampResultFor(durationMs);
      tracks.push({
        id: direction.id,
        voice: direction.voice,
        style: direction.style,
        file: opusRelPath,
        durationMs,
        // Untrusted alignment ships as an empty stamp list — sentence-level
        // karaoke fallback (design §11) beats wrong word highlights.
        timestamps: stampResult.trusted ? stampResult.stamps : [],
      });
      reports.push({
        storyId: story.id,
        trackId: direction.id,
        voice: direction.voice,
        style: direction.style,
        seed,
        durationMs,
        opusBytes: readFileSync(opusFile).byteLength,
        stampResult,
      });
    }
    renderedByStory.set(story.id, tracks);
  }

  // Assemble final audio per story: freshly rendered tracks replace same-id
  // carryovers; other existing tracks survive if their files are still there.
  const withStoryAudio: Pack = {
    ...pack,
    stories: pack.stories.map((story) => {
      const fresh = renderedByStory.get(story.id) ?? [];
      const freshIds = new Set(fresh.map((t) => t.id));
      const carried = (existingAudio.get(story.id) ?? []).filter(
        (t) => !freshIds.has(t.id) && existsSync(join(outDir, t.file)),
      );
      return { ...story, audio: [...carried, ...fresh] };
    }),
  };

  // Dialogues: carried node/choice audio first, fresh renders on top (T26).
  let withAudio = applyCarriedDialogueAudio(withStoryAudio, carriedNodeAudio);
  let dialogueReports: DialogueTrackReport[] = [];
  if (dialogueItems.length > 0) {
    const result = await runDialogueFinalize(client, withAudio, dialogueItems, outDir, {
      seeds: opts.seeds,
      defaultSeed: opts.defaultSeed,
      modelId: opts.modelId,
      newSeed,
    });
    withAudio = result.pack;
    dialogueReports = result.reports;
  }

  const validated = safeParsePack(withAudio);
  if (!validated.success) {
    const details = validated.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`assembled pack with audio failed schema validation:\n${details}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(packFile, `${JSON.stringify(validated.data, null, 2)}\n`, 'utf8');
  return { pack: validated.data, outFile: packFile, reports, dialogueReports };
}

export interface AudioRunPlan {
  /** Story × voice-direction tracks that would render. */
  storyTracks: number;
  /** Dialogue node lines that would render (incl. coach player lines). */
  dialogueNodes: number;
  /** Choice coach renders that would render (only with --player-audio). */
  dialogueChoices: number;
  /** ElevenLabs requests the run would fire. */
  requests: number;
  /** Total characters of narration text across those requests. */
  chars: number;
}

/**
 * Cost-control dry run (T26): what would `pipeline audio` send to ElevenLabs?
 * Fires no network calls — the CLI prints this and requires confirmation (or
 * `--yes`) before any render, so an accidental 60-node dialogue render never
 * fires silently.
 */
export function planAudioRun(
  draftPaths: readonly string[],
  opts: AudioFilters & {
    extrasPath?: string;
    audition?: boolean;
    takes?: number;
    modelId?: string;
  },
): AudioRunPlan {
  const { drafts, pack } = parseAll(draftPaths, opts.extrasPath);
  const plans = planStories(pack, drafts, opts);
  const dialogueItems = planDialogueItems(pack, opts);

  let storyRequests = 0;
  let storyChars = 0;
  for (const { story, directions, draftDir } of plans) {
    for (const direction of directions) {
      // One request per same-voice run (pre-rendered clips fire none), counting
      // the steering tags/cues/context that ride along in the text (they bill
      // like any other character).
      const runs = planNarrationRuns(
        story,
        direction,
        isV3Model(direction.model ?? opts.modelId ?? DEFAULT_MODEL_ID),
        draftDir,
      ).filter((r) => r.audioFile === undefined);
      storyRequests += runs.length;
      storyChars += runs.reduce((n, r) => n + r.narration.text.length, 0);
    }
  }

  let dialogueRequests: number;
  let dialogueChars: number;
  if (opts.audition) {
    // Audition renders one representative (longest) line per (dialogue,
    // character) group — mirror runDialogueAudition's grouping.
    const longestPerGroup = new Map<string, number>();
    for (const item of dialogueItems) {
      const cur = longestPerGroup.get(item.group) ?? -1;
      if (item.sentence.ru.length > cur) longestPerGroup.set(item.group, item.sentence.ru.length);
    }
    dialogueRequests = longestPerGroup.size;
    dialogueChars = [...longestPerGroup.values()].reduce((n, c) => n + c, 0);
  } else {
    dialogueRequests = dialogueItems.length;
    dialogueChars = dialogueItems.reduce((n, i) => n + i.sentence.ru.length, 0);
  }

  const takes = opts.audition ? (opts.takes ?? 3) : 1;
  return {
    storyTracks: storyRequests,
    dialogueNodes: dialogueItems.filter((i) => i.kind === 'node').length,
    dialogueChoices: dialogueItems.filter((i) => i.kind === 'choice').length,
    requests: (storyRequests + dialogueRequests) * takes,
    chars: (storyChars + dialogueChars) * takes,
  };
}
