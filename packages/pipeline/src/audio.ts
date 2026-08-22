import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParsePack, type AudioTrack, type Pack, type Story } from '@sumrak/schema';
import { annotateDrafts } from './annotate.ts';
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
  const drafts = files.map((f) => parseDraft(f.path, f.source));
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

async function renderDirection(
  client: ElevenLabsClient,
  story: Story,
  direction: VoiceDirection,
  seed: number,
  modelId: string | undefined,
): Promise<{ audio: Buffer; stampResultFor: (durationMs: number) => StampResult }> {
  const base = buildNarration(story);
  const model = modelId ?? DEFAULT_MODEL_ID;
  const v3 = isV3Model(model);
  // v3 rejects previous_text; mood steering there is the leading audio tag.
  // The tag becomes part of the rendered text, so shift every token span by
  // the prefix length — stamp mapping stays exact, and the tag's own
  // characters (near-silent in the alignment) are never stamped.
  const prefix = v3 && direction.audioTag ? `${direction.audioTag} ` : '';
  const narration: NarrationText = prefix
    ? {
        text: prefix + base.text,
        spans: base.spans.map((s) => ({
          ...s,
          start: s.start + prefix.length,
          end: s.end + prefix.length,
        })),
      }
    : base;
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

/** Render candidate takes for review. Writes MP3s, never touches pack.json. */
export async function runAudition(
  draftPaths: readonly string[],
  outDir: string,
  client: ElevenLabsClient,
  opts: AuditionOptions,
): Promise<AuditionTake[]> {
  const { drafts, pack } = parseAll(draftPaths, opts.extrasPath);
  const plans = planStories(pack, drafts, opts);
  if (plans.length === 0) throw new Error('no stories with voice directions matched the filters');

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
  return takes;
}

export interface AudioSummary {
  pack: Pack;
  outFile: string;
  reports: TrackReport[];
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
  if (plans.length === 0) throw new Error('no stories with voice directions matched the filters');

  // Carry over previously rendered tracks (story-by-story workflow).
  const packFile = join(outDir, 'pack.json');
  const existingAudio = new Map<string, AudioTrack[]>();
  if (existsSync(packFile)) {
    const prev = safeParsePack(JSON.parse(readFileSync(packFile, 'utf8')));
    if (prev.success) {
      for (const story of prev.data.stories) existingAudio.set(story.id, story.audio);
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
  const withAudio: Pack = {
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

  const validated = safeParsePack(withAudio);
  if (!validated.success) {
    const details = validated.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`assembled pack with audio failed schema validation:\n${details}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(packFile, `${JSON.stringify(validated.data, null, 2)}\n`, 'utf8');
  return { pack: validated.data, outFile: packFile, reports };
}
