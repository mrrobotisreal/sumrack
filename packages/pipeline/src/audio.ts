import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  safeParsePack,
  type AudioTrack,
  type NodeAudio,
  type Pack,
  type Sentence,
  type Story,
} from '@sumrak/schema';
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
import {
  concatRunsToMp3,
  decodeToWav,
  encodeOpus,
  measureLoudness,
  probeDurationMs,
} from './opus.ts';
import { mapAlignmentToStamps, type StampResult } from './stamps.ts';

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
  directions: VoiceDirection[];
}

function planStories(
  pack: Pack,
  drafts: readonly ParsedDraft[],
  filters: AudioFilters,
): StoryPlan[] {
  const byStory = new Map(drafts.map((d) => [d.frontmatter.story.id, d.frontmatter.voice ?? []]));
  const plans: StoryPlan[] = [];
  for (const story of pack.stories) {
    if (filters.stories && !filters.stories.includes(story.id)) continue;
    const all = byStory.get(story.id) ?? [];
    const directions = filters.tracks ? all.filter((v) => filters.tracks!.includes(v.id)) : all;
    if (directions.length > 0) plans.push({ story, directions });
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

function providerVoiceName(direction: VoiceDirection, voice = direction.voice): string {
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
  direction: Pick<VoiceDirection, 'id' | 'audioTag' | 'audioCues'>,
  v3: boolean,
): NarrationText {
  const cues = Object.entries(direction.audioCues ?? {});
  const firstSpanOf = new Map<string, number>();
  for (const s of base.spans)
    if (!firstSpanOf.has(s.sentenceId)) firstSpanOf.set(s.sentenceId, s.start);
  const unknown = cues.filter(([id]) => !firstSpanOf.has(id)).map(([id]) => id);
  if (unknown.length > 0) {
    throw new Error(
      `track "${direction.id}": audioCues reference sentence id(s) not in this story: ${unknown.join(', ')}`,
    );
  }
  if (!v3) return base;
  let narration = base;
  // Later insertion points first, so earlier offsets stay valid.
  const ordered = cues
    .map(([id, tags]) => ({ at: firstSpanOf.get(id)!, tags }))
    .sort((a, b) => b.at - a.at);
  for (const { at, tags } of ordered) narration = insertNarrationText(narration, at, `${tags} `);
  return direction.audioTag
    ? insertNarrationText(narration, 0, `${direction.audioTag} `)
    : narration;
}

/** One same-voice stretch of a story's sentences, with its steered narration text. */
export interface NarrationRun {
  /** Provider-prefixed voice this run renders with. */
  voice: string;
  /** True for a `sentenceVoices` override run (renders without the narrator `audioTag`). */
  override: boolean;
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
  direction: VoiceDirection,
  v3: boolean,
): NarrationRun[] {
  const ids = new Set(story.sentences.map((s) => s.id));
  const overrides = direction.sentenceVoices ?? {};
  const unknown = Object.keys(overrides).filter((id) => !ids.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `track "${direction.id}": sentenceVoices reference sentence id(s) not in this story: ${unknown.join(', ')}`,
    );
  }
  // Validate every cue against the whole story up front (a cue on an override
  // sentence is legal — it steers that run).
  steerNarration(buildNarrationFromSentences(story.sentences), direction, false);

  const groups: { voice: string; override: boolean; sentences: Sentence[] }[] = [];
  for (const sentence of story.sentences) {
    const voice = overrides[sentence.id] ?? direction.voice;
    const override = voice !== direction.voice;
    const last = groups.at(-1);
    if (last && last.voice === voice && last.override === override) last.sentences.push(sentence);
    else groups.push({ voice, override, sentences: [sentence] });
  }
  const cues = direction.audioCues ?? {};
  return groups.map((g) => {
    const own = new Set(g.sentences.map((s) => s.id));
    const runCues = Object.fromEntries(Object.entries(cues).filter(([id]) => own.has(id)));
    const narration = steerNarration(
      buildNarrationFromSentences(g.sentences),
      {
        id: direction.id,
        audioTag: g.override ? undefined : direction.audioTag,
        audioCues: runCues,
      },
      v3,
    );
    return { voice: g.voice, override: g.override, sentences: g.sentences, narration };
  });
}

/** Never boost a run into clipping when level-matching. */
const LEVEL_MATCH_PEAK_CEILING_DB = -1;

async function renderDirection(
  client: ElevenLabsClient,
  story: Story,
  direction: VoiceDirection,
  seed: number,
  modelId: string | undefined,
): Promise<{ audio: Buffer; stampResultFor: (durationMs: number) => StampResult }> {
  const model = modelId ?? DEFAULT_MODEL_ID;
  const v3 = isV3Model(model);
  // v3 rejects previous_text; mood steering there is the leading audio tag
  // plus any per-sentence cues. Tags become part of the rendered text, so
  // every token span shifts by the inserted length — stamp mapping stays
  // exact, and the tags' own characters (near-silent in the alignment) are
  // never stamped.
  const runs = planNarrationRuns(story, direction, v3);
  const rendered = [];
  for (const run of runs) {
    const voiceId = await client.resolveVoiceId(providerVoiceName(direction, run.voice));
    const result = await client.renderWithTimestamps({
      voiceId,
      text: run.narration.text,
      modelId: model,
      seed,
      ...(v3 || run.override ? {} : { previousText: direction.stylePrompt }),
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

  if (rendered.length === 1) {
    const only = rendered[0]!;
    return {
      audio: only.result.audio,
      stampResultFor: (durationMs) =>
        stampsOf(only.run.narration, only.result.alignment, durationMs),
    };
  }

  // Several voices: splice the per-run audio into ONE track (CT011 §5.4).
  // Decode each run to PCM (exact, gap-free durations), level-match override
  // runs to the narrator runs' mean level, concatenate sample-accurately, and
  // offset every run's stamps by the accumulated duration of the runs before
  // it so word stamps stay exact across each seam.
  const work = mkdtempSync(join(tmpdir(), 'sumrak-runs-'));
  try {
    const parts = rendered.map(({ run, result }, i) => {
      const mp3 = join(work, `run${i}.mp3`);
      const wav = join(work, `run${i}.wav`);
      writeFileSync(mp3, result.audio);
      decodeToWav(mp3, wav);
      return { run, result, wav, durationMs: probeDurationMs(wav), level: measureLoudness(wav) };
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

    // The per-run results are captured now; stamps are mapped lazily against
    // the final (Opus or MP3) duration like the single-run path.
    const runStamps = parts.map((p) => ({
      run: p.run,
      durationMs: p.durationMs,
      result: stampsOf(p.run.narration, p.result.alignment, p.durationMs),
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

  for (const { story, directions } of plans) {
    for (const direction of directions) {
      for (let take = 1; take <= opts.takes; take++) {
        const seed = newSeed();
        const rendered = await renderDirection(client, story, direction, seed, opts.modelId);
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

  for (const { story, directions } of plans) {
    const tracks: AudioTrack[] = [];
    for (const direction of directions) {
      const seed = opts.seeds?.[direction.id] ?? opts.defaultSeed ?? newSeed();
      const rendered = await renderDirection(client, story, direction, seed, opts.modelId);
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
  for (const { story, directions } of plans) {
    for (const direction of directions) {
      // One request per same-voice run, counting the steering tags/cues that
      // ride along in the text (they bill like any other character).
      const runs = planNarrationRuns(story, direction, isV3Model(opts.modelId ?? DEFAULT_MODEL_ID));
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
