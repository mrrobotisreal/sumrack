import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAYER_CHARACTER_ID,
  scenarioLines,
  type LineAudio,
  type Pack,
  type Scenario,
  type ScenarioCharacter,
  type ScenarioLine,
  type ScenarioLineKind,
  type Sentence,
} from '@sumrak/schema';
import type { ElevenLabsClient, VoiceSettings } from './elevenlabs.ts';
import {
  finalizeLine,
  renderLine,
  RequestPacer,
  type LineRenderSpec,
  type RenderedLine,
} from './line-audio.ts';
import { mouthTrackForFile } from './mouth-track.ts';
import { buildNarrationFromSentences } from './narration.ts';
import { probeDurationMs } from './opus.ts';
import type { CharacterCues } from './scenario-draft.ts';
import type { StampResult } from './stamps.ts';

/**
 * Per-line scenario rendering (T57, design SPEAKING_SCENARIOS §3). A scenario
 * renders MANY SMALL files on ElevenLabs Multilingual v2 — one per spoken
 * line in that line's character voice — through the same `line-audio.ts`
 * core dialogues use, plus:
 *
 * - **Variant steering** (v2 has no tags): the `confused` variant carries the
 *   character's confused cue as `previous_text` and nudges the settings
 *   (stability −0.1, style +0.1); `hint` carries the hint cue and slows to
 *   0.95×. Every other variant renders with the character's base steering.
 * - **Coach audio** (`--player-audio`): the model answer `accept[0]` of every
 *   expectation, spoken by the reserved `player` character's voice — an
 *   Ivan-class library voice, never `Mr. Wintrow` (decision 4). Coach lines
 *   have no annotated sentence in the pack, so they render as free text with
 *   no spans and ship as `audio/<scenarioId>/<turnId>-coach.opus` with a
 *   duration + mouth track but no stamps, attached to the turn's
 *   `expect.coachAudio` (the T26 `Choice.audio` precedent — T57 schema
 *   addition).
 * - **Mouth track** per rendered file (`mouth-track.ts`), written into the
 *   line's `LineAudio.mouth`; `--mouth-only` recomputes tracks for an
 *   already-rendered pack.json without any provider call.
 *
 * Audition/seed grouping is per (scenario, character) exactly like dialogues
 * (`--seed radio-a1/host=<n>`).
 */

/** Every render variant; `coach` is the player-voiced model answer. */
export type ScenarioVariant = ScenarioLineKind | 'coach';

/** Default steering cues when the draft's `characters[].cues` names none. */
export const DEFAULT_CUES: Required<CharacterCues> = {
  confused: 'Извини, я не совсем понял. Ты можешь повторить?',
  hint: 'Ничего, не спеши. Я помогу — давай ещё раз, медленно.',
};

/** Settings deltas per variant (SCENARIOS §3). */
export const CONFUSED_STABILITY_DELTA = -0.1;
export const CONFUSED_STYLE_DELTA = 0.1;
export const HINT_SPEED = 0.95;

/**
 * Base v2 settings every scenario line starts from — the provider's own
 * library-voice defaults (stability 0.5 / similarity 0.75 / style 0, speaker
 * boost on; the same knobs the `narrator` register pins). The variant deltas
 * apply on top; a plain `say` line sends exactly these.
 */
export const SCENARIO_BASE_SETTINGS: Required<VoiceSettings> = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
};

/** One ElevenLabs request the scenario render plan wants to make. */
export interface ScenarioRenderItem {
  scenarioId: string;
  variant: ScenarioVariant;
  /** The turn (say/retry/react/coach), glossary entry (explain/howtosay) or nudge kind. */
  label: string;
  character: ScenarioCharacter;
  /** The annotated line (absent for coach renders). */
  sentence?: Sentence;
  /** Free text for coach renders (`accept[0]`). */
  text?: string;
  /** Pack-relative output path, e.g. "audio/radio-a1/radio-a1-t02.opus". */
  file: string;
  /** Seed group key: `<scenarioId>/<characterId>`. */
  group: string;
  /** Object path of the line inside the scenario (to write audio back). */
  path?: (string | number)[];
}

export interface ScenarioPlanOptions {
  /** Only these scenario ids (all when absent). */
  scenarios?: string[];
  /** Render coach audio for `accept[0]` of every expectation. */
  playerAudio?: boolean;
}

/** Coach file for a prompting turn. */
export function coachFile(scenarioId: string, turnId: string): string {
  return `audio/${scenarioId}/${turnId}-coach.opus`;
}

/**
 * Plan the render items for a pack's scenarios in the `scenarioLines` order
 * (turn lines → retry → reacts → glossary → nudges), then coach lines.
 */
export function planScenarioItems(
  pack: Pack,
  opts: ScenarioPlanOptions = {},
): ScenarioRenderItem[] {
  const items: ScenarioRenderItem[] = [];
  for (const scenario of pack.scenarios ?? []) {
    if (opts.scenarios && !opts.scenarios.includes(scenario.id)) continue;
    const castById = new Map(scenario.cast.map((c) => [c.id, c]));
    for (const ref of scenarioLines(scenario)) {
      const speaker = castById.get(ref.speakerId);
      if (!speaker) continue; // schema validation reports this
      items.push({
        scenarioId: scenario.id,
        variant: ref.kind,
        label: labelOf(scenario, ref.path, ref.kind),
        character: speaker,
        sentence: ref.line.sentence,
        file: `audio/${scenario.id}/${ref.line.sentence.id}.opus`,
        group: `${scenario.id}/${speaker.id}`,
        path: ref.path,
      });
    }
    const player = castById.get(PLAYER_CHARACTER_ID);
    if (opts.playerAudio && player) {
      for (const turn of scenario.turns) {
        const model = turn.expect?.accept[0];
        if (model === undefined) continue;
        items.push({
          scenarioId: scenario.id,
          variant: 'coach',
          label: turn.id,
          character: player,
          text: model,
          file: coachFile(scenario.id, turn.id),
          group: `${scenario.id}/${PLAYER_CHARACTER_ID}`,
        });
      }
    }
  }
  return items;
}

function labelOf(scenario: Scenario, path: (string | number)[], kind: ScenarioLineKind): string {
  const [head, idx] = path;
  if (head === 'turns') return scenario.turns[idx as number]!.id;
  if (head === 'glossary') return scenario.glossary[idx as number]!.id;
  if (head === 'nudges') return `nudge/${scenario.nudges[idx as number]!.kind}`;
  return kind;
}

/**
 * Variant-steered v2 settings + `previous_text` for one item (SCENARIOS §3).
 * `Character` carries no stylePrompt (its `style` is a label), so the cue IS
 * the "spoken before" text: `confused` → the character's confused cue +
 * stability −0.1 / style +0.1; `hint` → the hint cue + speed 0.95; every
 * other variant → no previous_text, base settings (what a dialogue line
 * sends on v2).
 */
export function steerVariant(
  variant: ScenarioVariant,
  cues: CharacterCues | undefined,
): { previousText?: string; voiceSettings: VoiceSettings } {
  const base = { ...SCENARIO_BASE_SETTINGS };
  if (variant === 'confused') {
    return {
      previousText: cues?.confused ?? DEFAULT_CUES.confused,
      voiceSettings: {
        ...base,
        stability: clamp01(base.stability + CONFUSED_STABILITY_DELTA),
        style: clamp01(base.style + CONFUSED_STYLE_DELTA),
      },
    };
  }
  if (variant === 'hint') {
    return {
      previousText: cues?.hint ?? DEFAULT_CUES.hint,
      voiceSettings: { ...base, speed: HINT_SPEED },
    };
  }
  return { voiceSettings: base };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** Free-text narration (coach lines): the text with no token spans. */
function freeNarration(text: string): LineRenderSpec['narration'] {
  return { text, spans: [] };
}

function specOf(item: ScenarioRenderItem, cues: CuesByCharacter): LineRenderSpec {
  const { previousText, voiceSettings } = steerVariant(
    item.variant,
    cues[`${item.scenarioId}/${item.character.id}`],
  );
  return {
    voice: item.character.voice,
    characterId: item.character.id,
    narration: item.sentence
      ? buildNarrationFromSentences([item.sentence])
      : freeNarration(item.text!),
    ...(item.character.audioTag !== undefined && { audioTag: item.character.audioTag }),
    ...(previousText !== undefined && { previousText }),
    voiceSettings,
  };
}

/** `<scenarioId>/<characterId>` → the draft's render-time cues. */
export type CuesByCharacter = Record<string, CharacterCues | undefined>;

function renderItem(
  client: ElevenLabsClient,
  item: ScenarioRenderItem,
  seed: number,
  modelId: string | undefined,
  cues: CuesByCharacter,
): Promise<RenderedLine> {
  return renderLine(client, specOf(item, cues), seed, modelId);
}

export interface ScenarioAuditionTake {
  scenarioId: string;
  characterId: string;
  /** The representative line rendered for this group (its label + variant). */
  label: string;
  variant: ScenarioVariant;
  take: number;
  seed: number;
  file: string;
  stampResult: StampResult;
}

/**
 * Audition: N takes of ONE representative line per (scenario, character)
 * group — the group's longest line — as MP3s under `<outDir>/audition/`,
 * plus, when the group has a `confused` line, N takes of its longest
 * confused line too (the steering is what the audition decides on).
 */
export async function runScenarioAudition(
  client: ElevenLabsClient,
  items: readonly ScenarioRenderItem[],
  outDir: string,
  opts: { takes: number; modelId?: string; newSeed: () => number; cues?: CuesByCharacter },
): Promise<ScenarioAuditionTake[]> {
  const representatives = auditionRepresentatives(items);
  const auditionDir = join(outDir, 'audition');
  mkdirSync(auditionDir, { recursive: true });
  const takes: ScenarioAuditionTake[] = [];
  const pacer = new RequestPacer();
  for (const item of representatives) {
    for (let take = 1; take <= opts.takes; take++) {
      await pacer.next();
      const seed = opts.newSeed();
      const rendered = await renderItem(client, item, seed, opts.modelId, opts.cues ?? {});
      const file = join(
        auditionDir,
        `${item.scenarioId}--${item.character.id}--${item.variant}--take${take}--seed${seed}.mp3`,
      );
      writeFileSync(file, rendered.audio);
      takes.push({
        scenarioId: item.scenarioId,
        characterId: item.character.id,
        label: item.label,
        variant: item.variant,
        take,
        seed,
        file,
        stampResult: rendered.stampResultFor(probeDurationMs(file)),
      });
    }
  }
  return takes;
}

/** The longest plain line per group + the longest confused line per group (when any). */
export function auditionRepresentatives(
  items: readonly ScenarioRenderItem[],
): ScenarioRenderItem[] {
  const longest = new Map<string, ScenarioRenderItem>();
  const textOf = (i: ScenarioRenderItem) => i.sentence?.ru ?? i.text ?? '';
  for (const item of items) {
    const key = item.variant === 'confused' ? `${item.group}#confused` : item.group;
    const cur = longest.get(key);
    if (!cur || textOf(item).length > textOf(cur).length) longest.set(key, item);
  }
  return [...longest.values()];
}

export interface ScenarioTrackReport {
  scenarioId: string;
  variant: ScenarioVariant;
  label: string;
  characterId: string;
  voice: string;
  seed: number;
  durationMs: number;
  opusBytes: number;
  mouthLength: number;
  stampResult: StampResult;
}

export interface ScenarioFinalizeOptions {
  /** Seed per `<scenarioId>/<characterId>` group (from the audition). */
  seeds?: Record<string, number>;
  defaultSeed?: number;
  modelId?: string;
  newSeed: () => number;
  cues?: CuesByCharacter;
}

/**
 * Finalize: render every planned item, encode Opus into
 * `<outDir>/audio/<scenarioId>/`, map stamps, compute the mouth track, and
 * return the pack with `LineAudio` attached to every rendered line. Coach
 * renders go to `<outDir>/coach.json`.
 */
export async function runScenarioFinalize(
  client: ElevenLabsClient,
  pack: Pack,
  items: readonly ScenarioRenderItem[],
  outDir: string,
  opts: ScenarioFinalizeOptions,
): Promise<{ pack: Pack; reports: ScenarioTrackReport[] }> {
  const renderDir = join(outDir, 'render');
  mkdirSync(renderDir, { recursive: true });

  const groupSeed = new Map<string, number>();
  const seedFor = (group: string): number => {
    const pinned = opts.seeds?.[group];
    if (pinned !== undefined) return pinned;
    if (opts.defaultSeed !== undefined) return opts.defaultSeed;
    let seed = groupSeed.get(group);
    if (seed === undefined) {
      seed = opts.newSeed();
      groupSeed.set(group, seed);
    }
    return seed;
  };

  const reports: ScenarioTrackReport[] = [];
  const audioBySentenceId = new Map<string, LineAudio>();
  const coachByTurn = new Map<string, LineAudio>();

  const pacer = new RequestPacer();
  for (const item of items) {
    await pacer.next();
    const seed = seedFor(item.group);
    const rendered = await renderItem(client, item, seed, opts.modelId, opts.cues ?? {});
    const stem = item.sentence?.id ?? `${item.label}-coach`;
    const mp3File = join(renderDir, `${item.scenarioId}--${stem}.mp3`);
    const done = finalizeLine(rendered, outDir, item.file, mp3File);
    const mouth = mouthTrackForFile(
      join(outDir, item.file),
      done.durationMs,
      done.audio.timestamps,
      item.sentence,
    );
    const lineAudio: LineAudio = { ...done.audio, mouth };
    if (item.variant === 'coach') coachByTurn.set(`${item.scenarioId}/${item.label}`, lineAudio);
    else audioBySentenceId.set(item.sentence!.id, lineAudio);
    reports.push({
      scenarioId: item.scenarioId,
      variant: item.variant,
      label: item.label,
      characterId: item.character.id,
      voice: item.character.voice,
      seed,
      durationMs: done.durationMs,
      opusBytes: done.opusBytes,
      mouthLength: mouth.length,
      stampResult: done.stampResult,
    });
  }

  return { pack: attachLineAudio(pack, audioBySentenceId, coachByTurn), reports };
}

/**
 * Attach `LineAudio` by sentence id onto every scenario line of a pack, and
 * coach audio by `<scenarioId>/<turnId>` onto `expect.coachAudio` (others
 * untouched).
 */
export function attachLineAudio(
  pack: Pack,
  audioBySentenceId: Map<string, LineAudio>,
  coachByTurn: Map<string, LineAudio> = new Map(),
): Pack {
  if ((audioBySentenceId.size === 0 && coachByTurn.size === 0) || !pack.scenarios) return pack;
  const withAudio = (line: ScenarioLine): ScenarioLine => {
    const audio = audioBySentenceId.get(line.sentence.id);
    return audio ? { ...line, audio } : line;
  };
  return {
    ...pack,
    scenarios: pack.scenarios.map((scenario): Scenario => ({
      ...scenario,
      turns: scenario.turns.map((turn) => {
        const coach = coachByTurn.get(`${scenario.id}/${turn.id}`);
        return {
          ...turn,
          say: turn.say.map(withAudio),
          ...(turn.retry && {
            retry: {
              ...turn.retry,
              confused: withAudio(turn.retry.confused),
              hint: withAudio(turn.retry.hint),
              ...(turn.retry.second && { second: withAudio(turn.retry.second) }),
            },
          }),
          ...(turn.expect && {
            expect: {
              ...turn.expect,
              ...(turn.expect.reject && {
                reject: turn.expect.reject.map((group) =>
                  group.react ? { ...group, react: withAudio(group.react) } : group,
                ),
              }),
              ...(coach && { coachAudio: coach }),
            },
          }),
        };
      }),
      glossary: scenario.glossary.map((entry) => ({
        ...entry,
        explain: withAudio(entry.explain),
        howToSay: withAudio(entry.howToSay),
      })),
      nudges: scenario.nudges.map((nudge) => ({ ...nudge, line: withAudio(nudge.line) })),
    })),
  };
}

/**
 * Previously rendered scenario line audio to carry over (line-by-line
 * workflow): sentenceId → LineAudio, only for files still in the out dir.
 */
export function carriedScenarioAudio(
  prev: Pack,
  outDir: string,
): { lines: Map<string, LineAudio>; coach: Map<string, LineAudio> } {
  const lines = new Map<string, LineAudio>();
  const coach = new Map<string, LineAudio>();
  for (const scenario of prev.scenarios ?? []) {
    for (const ref of scenarioLines(scenario)) {
      const audio = ref.line.audio;
      if (audio && existsSync(join(outDir, audio.file))) lines.set(ref.line.sentence.id, audio);
    }
    for (const turn of scenario.turns) {
      const audio = turn.expect?.coachAudio;
      if (audio && existsSync(join(outDir, audio.file)))
        coach.set(`${scenario.id}/${turn.id}`, audio);
    }
  }
  return { lines, coach };
}

export interface MouthOnlyReport {
  scenarioId: string;
  sentenceId: string | null;
  file: string;
  durationMs: number;
  mouthLength: number;
  changed: boolean;
}

/**
 * `--mouth-only`: recompute the mouth track of every rendered scenario line
 * (and coach file) of an existing pack.json in place — no provider calls.
 * Returns the rewritten pack plus one row per file with whether the track
 * changed against what was stored.
 */
export function recomputeMouthTracks(
  pack: Pack,
  outDir: string,
  opts: ScenarioPlanOptions = {},
): { pack: Pack; reports: MouthOnlyReport[] } {
  const reports: MouthOnlyReport[] = [];
  const audioBySentenceId = new Map<string, LineAudio>();
  const coachByTurn = new Map<string, LineAudio>();
  for (const scenario of pack.scenarios ?? []) {
    if (opts.scenarios && !opts.scenarios.includes(scenario.id)) continue;
    for (const ref of scenarioLines(scenario)) {
      const audio = ref.line.audio;
      if (!audio) continue;
      const abs = join(outDir, audio.file);
      if (!existsSync(abs)) throw new Error(`--mouth-only: missing rendered file ${audio.file}`);
      const mouth = mouthTrackForFile(abs, audio.durationMs, audio.timestamps, ref.line.sentence);
      audioBySentenceId.set(ref.line.sentence.id, { ...audio, mouth });
      reports.push({
        scenarioId: scenario.id,
        sentenceId: ref.line.sentence.id,
        file: audio.file,
        durationMs: audio.durationMs,
        mouthLength: mouth.length,
        changed: mouth !== audio.mouth,
      });
    }
    for (const turn of scenario.turns) {
      const audio = turn.expect?.coachAudio;
      if (!audio) continue;
      const abs = join(outDir, audio.file);
      if (!existsSync(abs)) throw new Error(`--mouth-only: missing rendered file ${audio.file}`);
      const mouth = mouthTrackForFile(abs, audio.durationMs, undefined, undefined);
      coachByTurn.set(`${scenario.id}/${turn.id}`, { ...audio, mouth });
      reports.push({
        scenarioId: scenario.id,
        sentenceId: null,
        file: audio.file,
        durationMs: audio.durationMs,
        mouthLength: mouth.length,
        changed: mouth !== audio.mouth,
      });
    }
  }
  return { pack: attachLineAudio(pack, audioBySentenceId, coachByTurn), reports };
}
