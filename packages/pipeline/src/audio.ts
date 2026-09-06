import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  safeParsePack,
  type AudioTrack,
  type NodeAudio,
  type Pack,
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
import { buildNarration, type NarrationText } from './narration.ts';
import { encodeOpus, probeDurationMs } from './opus.ts';
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

function providerVoiceName(direction: VoiceDirection): string {
  const [provider, ...rest] = direction.voice.split(':');
  if (provider !== 'elevenlabs' || rest.length === 0) {
    throw new Error(
      `track "${direction.id}": unsupported voice "${direction.voice}" — only "elevenlabs:<name>" is implemented`,
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
  const narration = steerNarration(buildNarration(story), direction, v3);
  const voiceId = await client.resolveVoiceId(providerVoiceName(direction));
  const result = await client.renderWithTimestamps({
    voiceId,
    text: narration.text,
    modelId: model,
    seed,
    ...(v3 ? {} : { previousText: direction.stylePrompt }),
    voiceSettings: direction.settings,
  });
  return {
    audio: result.audio,
    stampResultFor: (durationMs: number) =>
      result.alignment
        ? mapAlignmentToStamps(narration, result.alignment, durationMs)
        : {
            stamps: [],
            trusted: false,
            wordTokens: narration.spans.filter((s) => !s.isPunct).length,
            stampedTokens: 0,
            coverage: 0,
            matchedCharRatio: 0,
            issues: ['provider returned no character alignment'],
          },
  };
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
  opts: AudioFilters & { extrasPath?: string; audition?: boolean; takes?: number },
): AudioRunPlan {
  const { drafts, pack } = parseAll(draftPaths, opts.extrasPath);
  const plans = planStories(pack, drafts, opts);
  const dialogueItems = planDialogueItems(pack, opts);

  let storyRequests = 0;
  let storyChars = 0;
  for (const { story, directions } of plans) {
    const chars = buildNarration(story).text.length;
    storyRequests += directions.length;
    storyChars += chars * directions.length;
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
