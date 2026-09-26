import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAYER_CHARACTER_ID,
  type Character,
  type Dialogue,
  type NodeAudio,
  type Pack,
  type Sentence,
} from '@sumrak/schema';
import type { ElevenLabsClient } from './elevenlabs.ts';
import {
  finalizeLine,
  renderLine,
  RequestPacer,
  type LineRenderSpec,
  type RenderedLine,
} from './line-audio.ts';
import { buildNarrationFromSentences } from './narration.ts';
import { probeDurationMs } from './opus.ts';
import type { StampResult } from './stamps.ts';

/**
 * Per-node dialogue rendering (T26, design V2 §3.2). Where T09 renders one
 * long track per story × voice direction, a dialogue renders MANY SMALL
 * files: one per node in that node's character voice/style, plus (behind
 * `--player-audio`) one coach render per choice and per scripted player line,
 * spoken by the reserved `player` character's voice (the T25 decision: the
 * player entry in `characters` names the coach voice).
 *
 * The per-line core (request → align → monotonic stamps → Opus → sidecar)
 * lives in `line-audio.ts` since T57 and is shared with the scenario
 * renderer: exact-char-span narration text (single sentence), v3 audioTag
 * steering (per character), the tolerant aligner with the ≥95% matched-char
 * gate, monotonicity clamp/drop rules, Opus encoding. Requests run serially
 * with a small politeness delay and one retry on rate-limit — dialogue =
 * many small calls.
 *
 * Audition/seed grouping is **per (dialogue, character)**: every node a
 * character speaks renders with that group's seed, so one audition take per
 * character is enough to pin the whole cast (`--seed <dialogueId>/<characterId>=<n>`).
 */

/** One ElevenLabs request the dialogue render plan wants to make. */
export interface DialogueRenderItem {
  dialogueId: string;
  /**
   * node = a node's own line (NPC, or a scripted player line under
   * --player-audio); choice = coach audio for one choice.
   */
  kind: 'node' | 'choice';
  nodeId: string;
  /** Set for kind 'choice'. */
  choiceId?: string;
  /** The character whose voice renders this item (player = coach). */
  character: Character;
  sentence: Sentence;
  /** Pack-relative output path, e.g. "audio/dinner-mini/din-n01.opus". */
  file: string;
  /** Seed group key: `<dialogueId>/<characterId>`. */
  group: string;
}

export interface DialoguePlanOptions {
  /** Only these dialogue ids (all when absent). */
  dialogues?: string[];
  /** Render coach audio for choices + scripted player lines. */
  playerAudio?: boolean;
}

/**
 * Plan the render items for a pack's dialogues, in declaration order.
 * Node/choice audio files are named by SENTENCE id under the dialogue's audio
 * dir — node sentence ids equal node ids by draft convention, and sentence
 * ids are pack-wide unique, so choice files can never collide either.
 */
export function planDialogueItems(
  pack: Pack,
  opts: DialoguePlanOptions = {},
): DialogueRenderItem[] {
  const items: DialogueRenderItem[] = [];
  for (const dialogue of pack.dialogues ?? []) {
    if (opts.dialogues && !opts.dialogues.includes(dialogue.id)) continue;
    const characterById = new Map(dialogue.characters.map((c) => [c.id, c]));
    const player = characterById.get(PLAYER_CHARACTER_ID);
    for (const node of dialogue.nodes) {
      const speaker = characterById.get(node.speakerId);
      if (!speaker) continue; // schema validation reports this; nothing to render
      const isPlayerLine = node.speakerId === PLAYER_CHARACTER_ID;
      if (!isPlayerLine || (opts.playerAudio && player)) {
        items.push({
          dialogueId: dialogue.id,
          kind: 'node',
          nodeId: node.id,
          character: speaker,
          sentence: node.sentence,
          file: `audio/${dialogue.id}/${node.sentence.id}.opus`,
          group: `${dialogue.id}/${speaker.id}`,
        });
      }
      if (opts.playerAudio && player) {
        for (const choice of node.choices ?? []) {
          items.push({
            dialogueId: dialogue.id,
            kind: 'choice',
            nodeId: node.id,
            choiceId: choice.id,
            character: player,
            sentence: choice.sentence,
            file: `audio/${dialogue.id}/${choice.sentence.id}.opus`,
            group: `${dialogue.id}/${PLAYER_CHARACTER_ID}`,
          });
        }
      }
    }
  }
  return items;
}

export interface DialogueTrackReport {
  dialogueId: string;
  kind: 'node' | 'choice';
  /** node id, or `<nodeId>/<choiceId>` for coach renders. */
  label: string;
  characterId: string;
  voice: string;
  seed: number;
  durationMs: number;
  opusBytes: number;
  stampResult: StampResult;
}

export interface DialogueAuditionTake {
  dialogueId: string;
  characterId: string;
  /** The representative node rendered for this group. */
  nodeId: string;
  take: number;
  seed: number;
  file: string;
  stampResult: StampResult;
}

/** The line-audio spec for one dialogue item (v3 tag from the character; no v2 steering). */
function specOf(item: DialogueRenderItem): LineRenderSpec {
  return {
    voice: item.character.voice,
    characterId: item.character.id,
    narration: buildNarrationFromSentences([item.sentence]),
    ...(item.character.audioTag !== undefined && { audioTag: item.character.audioTag }),
  };
}

function renderItem(
  client: ElevenLabsClient,
  item: DialogueRenderItem,
  seed: number,
  modelId: string | undefined,
): Promise<RenderedLine> {
  return renderLine(client, specOf(item), seed, modelId);
}

/**
 * Audition: render N takes of ONE representative node per (dialogue,
 * character) group — the group's longest line, the take with the most signal
 * — as MP3s under `<outDir>/audition/`. Never touches pack.json. Pin the
 * winning seed per group with `--seed <dialogueId>/<characterId>=<n>`.
 */
export async function runDialogueAudition(
  client: ElevenLabsClient,
  items: readonly DialogueRenderItem[],
  outDir: string,
  opts: { takes: number; modelId?: string; newSeed: () => number },
): Promise<DialogueAuditionTake[]> {
  const representatives = new Map<string, DialogueRenderItem>();
  for (const item of items) {
    const cur = representatives.get(item.group);
    if (!cur || item.sentence.ru.length > cur.sentence.ru.length) {
      representatives.set(item.group, item);
    }
  }

  const auditionDir = join(outDir, 'audition');
  mkdirSync(auditionDir, { recursive: true });
  const takes: DialogueAuditionTake[] = [];
  const pacer = new RequestPacer();
  for (const item of representatives.values()) {
    for (let take = 1; take <= opts.takes; take++) {
      await pacer.next();
      const seed = opts.newSeed();
      const rendered = await renderItem(client, item, seed, opts.modelId);
      const file = join(
        auditionDir,
        `${item.dialogueId}--${item.character.id}--take${take}--seed${seed}.mp3`,
      );
      writeFileSync(file, rendered.audio);
      takes.push({
        dialogueId: item.dialogueId,
        characterId: item.character.id,
        nodeId: item.nodeId,
        take,
        seed,
        file,
        stampResult: rendered.stampResultFor(probeDurationMs(file)),
      });
    }
  }
  return takes;
}

export interface DialogueFinalizeOptions {
  /** Seed per `<dialogueId>/<characterId>` group (from the audition). */
  seeds?: Record<string, number>;
  defaultSeed?: number;
  modelId?: string;
  newSeed: () => number;
}

/**
 * Finalize: render every planned item, encode Opus into
 * `<outDir>/audio/<dialogueId>/`, map word stamps (per-node ≥95% gate +
 * monotonicity — an untrusted alignment ships NO stamps for that file; a
 * `<mp3>.stamps.json` sidecar lands next to each render), and
 * return the pack with `NodeAudio` attached to the rendered nodes/choices.
 * Previously attached audio on nodes that were not re-rendered is preserved
 * by the caller's carry-over (audio.ts merges pack.json runs).
 */
export async function runDialogueFinalize(
  client: ElevenLabsClient,
  pack: Pack,
  items: readonly DialogueRenderItem[],
  outDir: string,
  opts: DialogueFinalizeOptions,
): Promise<{ pack: Pack; reports: DialogueTrackReport[] }> {
  const renderDir = join(outDir, 'render');
  mkdirSync(renderDir, { recursive: true });

  // One seed per group even when unpinned, so a character stays internally
  // consistent across their nodes within a single run.
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

  const reports: DialogueTrackReport[] = [];
  const audioBySentenceId = new Map<string, NodeAudio>();

  const pacer = new RequestPacer();
  for (const item of items) {
    await pacer.next();
    const seed = seedFor(item.group);
    const rendered = await renderItem(client, item, seed, opts.modelId);
    const mp3File = join(renderDir, `${item.dialogueId}--${item.sentence.id}.mp3`);
    const done = finalizeLine(rendered, outDir, item.file, mp3File);
    audioBySentenceId.set(item.sentence.id, done.audio);
    reports.push({
      dialogueId: item.dialogueId,
      kind: item.kind,
      label: item.kind === 'choice' ? `${item.nodeId}/${item.choiceId}` : item.nodeId,
      characterId: item.character.id,
      voice: item.character.voice,
      seed,
      durationMs: done.durationMs,
      opusBytes: done.opusBytes,
      stampResult: done.stampResult,
    });
  }

  const withAudio: Pack = {
    ...pack,
    dialogues: (pack.dialogues ?? []).map((dialogue): Dialogue => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => {
        const nodeAudio = audioBySentenceId.get(node.sentence.id);
        const next = { ...node };
        if (nodeAudio) next.audio = nodeAudio;
        if (node.choices) {
          next.choices = node.choices.map((choice) => {
            const choiceAudio = audioBySentenceId.get(choice.sentence.id);
            return choiceAudio ? { ...choice, audio: choiceAudio } : choice;
          });
        }
        return next;
      }),
    })),
  };
  return { pack: withAudio, reports };
}
