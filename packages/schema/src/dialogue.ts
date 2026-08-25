import { z } from 'zod';
import { CefrLevelSchema, LocalizedTextSchema, RelativePathSchema, StableIdSchema } from './common';
import { SentenceSchema, WordStampSchema } from './sentence';

/**
 * The `dialogue` pack type (T25, design V2 §3.1): a branching node graph the
 * player walks by *speaking* their choice (T27's engine; ASR picks the
 * branch). Every line — NPC and player alike — is a fully annotated
 * {@link SentenceSchema} so dialogue text is tap-word explorable and feeds the
 * word bank/progress model exactly like story sentences.
 *
 * ## The choices-vs-player-node modeling decision (frozen here; T26/T27 rely on it)
 *
 * **Choices live on the node that awaits the player's answer** (an NPC line,
 * typically a question). A {@link ChoiceSchema Choice} IS the player's
 * utterance: a fully annotated Sentence plus the branch target. There are no
 * dedicated "player choice nodes". Consequences:
 *
 * - T27's engine walk is a single loop: render the node (speaker line +
 *   audio); if it has `choices`, collect the player's answer (ASR, tap
 *   fallback) and jump to the matched choice's `next`; if it has `next`,
 *   continue there; if it has `endingId`, finish.
 * - Choices implicitly speak as `player`, so a node carrying `choices` must
 *   NOT itself have `speakerId === "player"` (the player cannot await their
 *   own answer) — enforced below.
 * - A node MAY have `speakerId: "player"` with `next`/`endingId`: a scripted,
 *   non-branching player line (rendered as the player's own speech; optional
 *   coach model audio in T26).
 * - In draft-authored packs the node's sentence id equals the node id and a
 *   choice's sentence id equals the choice id (pipeline convention, not a
 *   schema rule) — sentence ids stay pack-wide unique either way.
 */

/** Reserved character id marking the learner (the "you" of the dialogue). */
export const PLAYER_CHARACTER_ID = 'player';

/** Graph bounds (design V2 §3.1): keep dialogues walkable and authorable. */
export const MAX_DIALOGUE_NODES = 60;
export const MIN_CHOICES_PER_NODE = 2;
export const MAX_CHOICES_PER_NODE = 4;

/**
 * One speaking character of a dialogue. `voice`/`style` follow the AudioTrack
 * conventions (provider-prefixed voice id + style label) and drive T26's
 * per-node rendering. For the reserved `player` character they name the
 * neutral "coach" voice used for optional model audio of player lines/choices
 * («hear how to say it») — required so the pack stays self-describing.
 */
export const CharacterSchema = z.strictObject({
  /** Stable id, unique within the dialogue. `player` is reserved for the learner. */
  id: StableIdSchema,
  /** Bilingual display name («Мама» / "Mama"). */
  name: LocalizedTextSchema,
  /** Provider-prefixed voice id, e.g. "elevenlabs:Mariia". */
  voice: z
    .string()
    .regex(/^[a-z0-9-]+:.+$/, 'voice is provider-prefixed, e.g. "elevenlabs:<voice-name>"'),
  /** Emotional/delivery style: "warm", "gentle", "creepy-whisper", ... */
  style: z.string().min(1),
  /**
   * Optional Eleven v3 audio tag(s) prepended to this character's node
   * renders, e.g. "[warm]" — steers delivery without being spoken (T26;
   * mirrors VoiceDirection.audioTag from the story-draft frontmatter).
   * v3-family models only; ignored for other models.
   */
  audioTag: z
    .string()
    .regex(/^\[[^\]]+\](\s*\[[^\]]+\])*$/, 'audioTag is one or more [bracketed] v3 audio tags')
    .optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const EndingToneSchema = z.enum(['good', 'bad', 'strange']);
export type EndingTone = z.infer<typeof EndingToneSchema>;

/**
 * One ending of a dialogue. Endings behave like mini-achievements in the app
 * («Концовки: 2/4», T27); `recap` is the RU-with-reveal-EN summary shown on
 * the ending screen.
 */
export const EndingSchema = z.strictObject({
  /** Stable id, unique within the dialogue; referenced by nodes' `endingId`. */
  id: StableIdSchema,
  /** Bilingual ending title. */
  title: LocalizedTextSchema,
  /** Bilingual recap of how this ending came about. */
  recap: LocalizedTextSchema,
  /** Emotional color of the ending — drives the ending screen's treatment. */
  tone: EndingToneSchema,
});
export type Ending = z.infer<typeof EndingSchema>;

/**
 * Per-node narration audio (rendered by T26's `pipeline audio`). Unlike story
 * AudioTracks there is exactly one rendition per node (the node's character
 * voice/style), so no id/voice/style here — the character carries those.
 * `timestamps` reference the node's OWN sentence (enforced on the node).
 */
export const NodeAudioSchema = z.strictObject({
  /** Audio file path relative to the pack dir, e.g. "audio/dinner-mini/din-n01.opus". */
  file: RelativePathSchema,
  /** Total duration of the audio file in milliseconds. */
  durationMs: z.number().int().positive(),
  /** Word-level karaoke timestamps into this node's sentence. Absent/empty = sentence-level highlight. */
  timestamps: z.array(WordStampSchema).optional(),
});
export type NodeAudio = z.infer<typeof NodeAudioSchema>;

/**
 * One player answer at a choice point. The choice IS the player's line (see
 * the modeling decision above): a fully annotated sentence, the node the
 * story branches to, optional alternate phrasings the ASR matcher also
 * accepts, and an optional bilingual nudge shown on long-press.
 */
export const ChoiceSchema = z
  .strictObject({
    /** Stable id, unique within the node (analytics + path recap reference it). */
    id: StableIdSchema,
    /** The player's utterance, fully annotated (tap-word works on choice cards). */
    sentence: SentenceSchema,
    /** Node this choice branches to. */
    next: StableIdSchema,
    /**
     * Acceptable alternate phrasings (natural text; the app normalizes for
     * matching) so natural variation still selects this choice.
     */
    asrAlternates: z.array(z.string().min(1)).min(1).optional(),
    /** Bilingual nudge shown on long-press (EN side is the primary hint). */
    hint: LocalizedTextSchema.optional(),
    /**
     * Optional coach model audio for this choice («hear how to say it»),
     * rendered by T26's `--player-audio` with the `player` character's
     * voice/style. Timestamps reference this choice's OWN sentence.
     */
    audio: NodeAudioSchema.optional(),
  })
  .superRefine((choice, ctx) => {
    choice.asrAlternates?.forEach((alt, i) => {
      if (alt !== alt.normalize('NFC')) {
        ctx.addIssue({
          code: 'custom',
          path: ['asrAlternates', i],
          message: 'asrAlternates text must be UTF-8 NFC-normalized',
        });
      }
    });
    // Choice audio stamps must reference this choice's own sentence (the
    // same rule nodes enforce for their audio).
    choice.audio?.timestamps?.forEach((stamp, wi) => {
      const path = ['audio', 'timestamps', wi];
      if (stamp.sentenceId !== choice.sentence.id) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'sentenceId'],
          message: `choice audio stamp references sentence "${stamp.sentenceId}", but choice "${choice.id}" speaks sentence "${choice.sentence.id}"`,
        });
        return;
      }
      if (stamp.tokenIndex >= choice.sentence.tokens.length) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'tokenIndex'],
          message: `tokenIndex ${stamp.tokenIndex} is out of range for sentence "${stamp.sentenceId}" (${choice.sentence.tokens.length} tokens)`,
        });
      }
      if (choice.audio && stamp.endMs > choice.audio.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'endMs'],
          message: `choice audio stamp ends at ${stamp.endMs}ms, past the audio duration ${choice.audio.durationMs}ms`,
        });
      }
    });
  });
export type Choice = z.infer<typeof ChoiceSchema>;

/**
 * One node of the dialogue graph: a single spoken line plus how the story
 * continues. Exactly one of `choices` (player answers here), `next`
 * (linear continuation), or `endingId` (the dialogue finishes) — enforced.
 */
export const DialogueNodeSchema = z
  .strictObject({
    /** Stable id, unique within the dialogue. */
    id: StableIdSchema,
    /** Which character speaks this line (must resolve; may be "player" for scripted player lines). */
    speakerId: StableIdSchema,
    /** The spoken line, fully annotated. */
    sentence: SentenceSchema,
    /** Per-node narration audio (T26). NPC lines always ship it once the pack ships audio. */
    audio: NodeAudioSchema.optional(),
    /** Player answers at this choice point (2–4). Mutually exclusive with next/endingId. */
    choices: z.array(ChoiceSchema).min(MIN_CHOICES_PER_NODE).max(MAX_CHOICES_PER_NODE).optional(),
    /** Linear continuation: the next node's id. Mutually exclusive with choices/endingId. */
    next: StableIdSchema.optional(),
    /** The dialogue ends here with this ending. Mutually exclusive with choices/next. */
    endingId: StableIdSchema.optional(),
  })
  .superRefine((node, ctx) => {
    const present = (['choices', 'next', 'endingId'] as const).filter((k) => node[k] !== undefined);
    if (present.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          `node "${node.id}" must have exactly one of "choices", "next", or "endingId"` +
          (present.length === 0 ? ' (has none)' : ` (has: ${present.join(', ')})`),
      });
    }
    // Choice ids unique within the node.
    const seen = new Set<string>();
    node.choices?.forEach((choice, ci) => {
      if (seen.has(choice.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['choices', ci, 'id'],
          message: `duplicate choice id "${choice.id}" in node "${node.id}"`,
        });
      }
      seen.add(choice.id);
    });
    // Node audio stamps must reference this node's own sentence.
    node.audio?.timestamps?.forEach((stamp, wi) => {
      const path = ['audio', 'timestamps', wi];
      if (stamp.sentenceId !== node.sentence.id) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'sentenceId'],
          message: `node audio stamp references sentence "${stamp.sentenceId}", but node "${node.id}" speaks sentence "${node.sentence.id}"`,
        });
        return;
      }
      if (stamp.tokenIndex >= node.sentence.tokens.length) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'tokenIndex'],
          message: `tokenIndex ${stamp.tokenIndex} is out of range for sentence "${stamp.sentenceId}" (${node.sentence.tokens.length} tokens)`,
        });
      }
      if (node.audio && stamp.endMs > node.audio.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'endMs'],
          message: `node audio stamp ends at ${stamp.endMs}ms, past the audio duration ${node.audio.durationMs}ms`,
        });
      }
    });
  });
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

/**
 * Pure graph analysis over a dialogue's node graph, shared by the schema
 * refinements below (path-precise errors), the pipeline's draft assembly
 * (file:line errors), and the branch-map rendering (authoring aid). Tolerant
 * of dangling references — an edge to an unknown node is simply not an edge
 * (resolvability is reported separately).
 *
 * Every result list is in declaration order, so consumers are deterministic.
 */
export interface DialogueGraphAnalysis {
  /** Node ids reachable from `startNodeId` (including it, when it resolves). */
  reachable: Set<string>;
  /** Node ids from which some ending node is reachable. */
  canReachEnding: Set<string>;
  /** Reachable nodes that can never reach an ending — dead traps (cycles without an exit). */
  deadTraps: string[];
  /** Nodes not reachable from `startNodeId`. */
  unreachable: string[];
  /** Ending ids no node references. */
  unreferencedEndings: string[];
  /** Ending ids actually reachable from the start. */
  reachableEndings: string[];
  /** Node count of the shortest start→ending path (start and ending node included); null if none. */
  shortestPathNodes: number | null;
  /** Node count of the longest simple start→ending path; null if none. */
  longestPathNodes: number | null;
  /** True when the longest-path search hit its exploration cap (value is a lower bound). */
  longestPathCapped: boolean;
  /** Whether any cycle exists among reachable nodes. */
  hasCycle: boolean;
}

/** The subset of a Dialogue the graph analysis needs (assembly can pass a pre-validation shape). */
export interface DialogueGraphInput {
  nodes: readonly Pick<DialogueNode, 'id' | 'choices' | 'next' | 'endingId'>[];
  startNodeId: string;
  endings: readonly Pick<Ending, 'id'>[];
}

/** Outgoing edges of a node, skipping targets that don't resolve. */
function edgesOf(node: DialogueGraphInput['nodes'][number], ids: ReadonlySet<string>): string[] {
  const targets = node.next !== undefined ? [node.next] : (node.choices?.map((c) => c.next) ?? []);
  return targets.filter((t) => ids.has(t));
}

/** Safety cap on the longest-simple-path DFS (branch-map stat only, never validation). */
const LONGEST_PATH_STEP_CAP = 50_000;

export function analyzeDialogueGraph(dialogue: DialogueGraphInput): DialogueGraphAnalysis {
  const nodeIds = new Set(dialogue.nodes.map((n) => n.id));
  const byId = new Map(dialogue.nodes.map((n) => [n.id, n]));

  // Forward reachability from the start (iterative DFS, declaration-ordered pushes).
  const reachable = new Set<string>();
  if (nodeIds.has(dialogue.startNodeId)) {
    const stack = [dialogue.startNodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const next of edgesOf(byId.get(id)!, nodeIds)) stack.push(next);
    }
  }

  // Reverse reachability: which nodes can reach an ending node?
  const reversed = new Map<string, string[]>();
  for (const node of dialogue.nodes) {
    for (const next of edgesOf(node, nodeIds)) {
      const list = reversed.get(next);
      if (list) list.push(node.id);
      else reversed.set(next, [node.id]);
    }
  }
  const canReachEnding = new Set<string>();
  const endingIds = new Set(dialogue.endings.map((e) => e.id));
  const reverseStack = dialogue.nodes
    .filter((n) => n.endingId !== undefined && endingIds.has(n.endingId))
    .map((n) => n.id);
  while (reverseStack.length > 0) {
    const id = reverseStack.pop()!;
    if (canReachEnding.has(id)) continue;
    canReachEnding.add(id);
    for (const prev of reversed.get(id) ?? []) reverseStack.push(prev);
  }

  const unreachable = dialogue.nodes.map((n) => n.id).filter((id) => !reachable.has(id));
  const deadTraps = dialogue.nodes
    .map((n) => n.id)
    .filter((id) => reachable.has(id) && !canReachEnding.has(id));

  const referencedEndings = new Set(
    dialogue.nodes
      .map((n) => n.endingId)
      .filter((e): e is string => e !== undefined && endingIds.has(e)),
  );
  const unreferencedEndings = dialogue.endings
    .map((e) => e.id)
    .filter((id) => !referencedEndings.has(id));
  const reachableEndings = dialogue.endings
    .map((e) => e.id)
    .filter((id) => dialogue.nodes.some((n) => n.endingId === id && reachable.has(n.id)));

  // Shortest start→ending path (BFS, counting nodes on the path).
  let shortestPathNodes: number | null = null;
  if (nodeIds.has(dialogue.startNodeId)) {
    const queue: [string, number][] = [[dialogue.startNodeId, 1]];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const [id, depth] = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id)!;
      if (node.endingId !== undefined && endingIds.has(node.endingId)) {
        shortestPathNodes = depth;
        break;
      }
      for (const next of edgesOf(node, nodeIds)) queue.push([next, depth + 1]);
    }
  }

  // Longest SIMPLE start→ending path (DFS with an on-path set, step-capped).
  let longestPathNodes: number | null = null;
  let longestPathCapped = false;
  let hasCycle = false;
  if (nodeIds.has(dialogue.startNodeId)) {
    let steps = 0;
    const onPath = new Set<string>();
    const walk = (id: string, depth: number): void => {
      if (steps >= LONGEST_PATH_STEP_CAP) {
        longestPathCapped = true;
        return;
      }
      steps += 1;
      const node = byId.get(id)!;
      if (node.endingId !== undefined && endingIds.has(node.endingId)) {
        if (longestPathNodes === null || depth > longestPathNodes) longestPathNodes = depth;
        return;
      }
      onPath.add(id);
      for (const next of edgesOf(node, nodeIds)) {
        if (onPath.has(next)) {
          hasCycle = true;
          continue;
        }
        walk(next, depth + 1);
      }
      onPath.delete(id);
    };
    walk(dialogue.startNodeId, 1);
  }

  return {
    reachable,
    canReachEnding,
    deadTraps,
    unreachable,
    unreferencedEndings,
    reachableEndings,
    shortestPathNodes,
    longestPathNodes,
    longestPathCapped,
    hasCycle,
  };
}

/**
 * One branching dialogue (design V2 §3.1). Graph invariants enforced here
 * (all with path-precise messages — T26/T27 sessions debug against these):
 *
 * - character/ending/node ids unique; `speakerId` resolves;
 * - a node with `choices` never speaks as `player` (see modeling decision);
 * - `startNodeId` and every `next`/choice-target/`endingId` resolves;
 * - every node reachable from `startNodeId`;
 * - no dead traps: from every reachable node an ending stays reachable
 *   (cycles are allowed — «Ещё борща?» loops — but every cycle needs an
 *   exit path; this also guarantees ≥1 reachable ending);
 * - every ending is referenced by at least one node;
 * - if any node ships audio, every non-player node must (packs are either
 *   audio-less (pre-T26) or fully voiced — no half-voiced dialogues).
 */
export const DialogueSchema = z
  .strictObject({
    /** Stable id, unique within the pack. */
    id: StableIdSchema,
    /** Bilingual dialogue title. */
    title: LocalizedTextSchema,
    /** CEFR level of this dialogue. */
    level: CefrLevelSchema,
    /** The cast. One id may be "player" (the learner). */
    characters: z.array(CharacterSchema).min(1),
    /** The node graph, ≤60 nodes. */
    nodes: z.array(DialogueNodeSchema).min(1).max(MAX_DIALOGUE_NODES),
    /** Where the dialogue starts (must resolve to a node). */
    startNodeId: StableIdSchema,
    /** The dialogue's endings (≥1; all must be referenced). */
    endings: z.array(EndingSchema).min(1),
  })
  .superRefine((dialogue, ctx) => {
    // --- id uniqueness -------------------------------------------------
    const characterIds = new Set<string>();
    dialogue.characters.forEach((c, i) => {
      if (characterIds.has(c.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['characters', i, 'id'],
          message: `duplicate character id "${c.id}"`,
        });
      }
      characterIds.add(c.id);
    });
    const endingIds = new Set<string>();
    dialogue.endings.forEach((e, i) => {
      if (endingIds.has(e.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endings', i, 'id'],
          message: `duplicate ending id "${e.id}"`,
        });
      }
      endingIds.add(e.id);
    });
    const nodeIds = new Set<string>();
    dialogue.nodes.forEach((n, i) => {
      if (nodeIds.has(n.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `duplicate node id "${n.id}"`,
        });
      }
      nodeIds.add(n.id);
    });

    // --- per-node reference checks ------------------------------------
    let refsResolve = true;
    dialogue.nodes.forEach((node, i) => {
      if (!characterIds.has(node.speakerId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'speakerId'],
          message: `node "${node.id}" speakerId "${node.speakerId}" does not resolve to a character`,
        });
      }
      if (node.choices !== undefined && node.speakerId === PLAYER_CHARACTER_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'choices'],
          message: `node "${node.id}" carries choices but speaks as "player" — choices already speak as the player; put them on the line being answered (an NPC node)`,
        });
      }
      if (node.next !== undefined && !nodeIds.has(node.next)) {
        refsResolve = false;
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'next'],
          message: `node "${node.id}" next "${node.next}" does not resolve to a node`,
        });
      }
      if (node.endingId !== undefined && !endingIds.has(node.endingId)) {
        refsResolve = false;
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'endingId'],
          message: `node "${node.id}" endingId "${node.endingId}" does not resolve to an ending`,
        });
      }
      node.choices?.forEach((choice, ci) => {
        if (!nodeIds.has(choice.next)) {
          refsResolve = false;
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', i, 'choices', ci, 'next'],
            message: `choice "${choice.id}" next "${choice.next}" does not resolve to a node`,
          });
        }
      });
    });
    if (!nodeIds.has(dialogue.startNodeId)) {
      refsResolve = false;
      ctx.addIssue({
        code: 'custom',
        path: ['startNodeId'],
        message: `startNodeId "${dialogue.startNodeId}" does not resolve to a node`,
      });
    }

    // --- graph properties (only when all references resolve — otherwise
    // reachability noise would bury the real, more precise errors) -------
    if (refsResolve) {
      const analysis = analyzeDialogueGraph(dialogue);
      const indexOfNode = new Map(dialogue.nodes.map((n, i) => [n.id, i]));
      for (const id of analysis.unreachable) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', indexOfNode.get(id)!],
          message: `node "${id}" is unreachable from startNodeId "${dialogue.startNodeId}"`,
        });
      }
      for (const id of analysis.deadTraps) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', indexOfNode.get(id)!],
          message: `node "${id}" can never reach an ending (dead trap — every cycle needs an exit path to an ending)`,
        });
      }
      const indexOfEnding = new Map(dialogue.endings.map((e, i) => [e.id, i]));
      for (const id of analysis.unreferencedEndings) {
        ctx.addIssue({
          code: 'custom',
          path: ['endings', indexOfEnding.get(id)!],
          message: `ending "${id}" is never referenced by any node`,
        });
      }
    }

    // --- audio all-or-nothing (per non-player node) --------------------
    if (dialogue.nodes.some((n) => n.audio !== undefined)) {
      dialogue.nodes.forEach((node, i) => {
        if (node.audio === undefined && node.speakerId !== PLAYER_CHARACTER_ID) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', i, 'audio'],
            message: `dialogue ships audio but node "${node.id}" (speaker "${node.speakerId}") has none — every non-player node needs audio once any node has it`,
          });
        }
      });
    }
  });
export type Dialogue = z.infer<typeof DialogueSchema>;
