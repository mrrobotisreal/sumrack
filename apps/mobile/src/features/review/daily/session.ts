import { z } from 'zod';

import type { BankItemRow } from '@/db/repositories/bank';
import { UNIFIED_SESSION_DIRECTIONS, type CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';
import { track } from '@/services/analytics';

import { buildMcChoices, spreadSameItem, type SessionItem } from '../session';
import { buildReadIndex, type ReadIndex } from '../games/sentence-source';
import { buildClozeItemForCard, type ClozeItem } from '../games/cloze/session';
import { buildSbItemForCard, type SbItem } from '../games/sentence-builder/session';
import {
  buildListeningItemForCard,
  type ListeningItem,
  type ListeningVariant,
} from '../games/listening/session';
import {
  DAILY_MODES,
  DEFAULT_DAILY_PREFS,
  weightForMode,
  type DailyMode,
  type DailyWeights,
} from './prefs';

/**
 * The unified daily session (T14, design §7.3 "daily session"): one flow
 * serving the due queue through a weighted mix of every implemented mode.
 * Composition rules:
 *
 * - Due cards only (most-overdue first, T06 fairness) — the daily session
 *   is the honest answer to "what's due", unlike the standalone games which
 *   top up with weak cards to stay playable.
 * - A card's direction decides what can serve it: `listening` cards are
 *   playable only by the listening quiz (that's the skill they schedule);
 *   ru-en/en-ru cards by flashcard/MC/cloze/sentence-builder.
 * - Weights set target counts per mode (largest-remainder apportionment).
 *   A mode that can't fill its slots — no listening cards due, no eligible
 *   sentence for cloze, distractor shortage for MC — hands them to the
 *   modes that can, deterministically, never erroring: flashcard is the
 *   universal fallback every text card can play (weight 0 only downweights
 *   its *target*; it stays the safety net).
 * - Weight 0 = never serve that mode by choice; all-zero weights heal to
 *   the defaults rather than producing an empty session.
 */
export type DailyItem =
  | { mode: 'flashcard' | 'mc'; entry: SessionItem }
  | { mode: 'cloze'; entry: ClozeItem }
  | { mode: 'sentence-builder'; entry: SbItem }
  | { mode: 'listening'; entry: ListeningItem };

export function dailyItemCard(item: DailyItem): CardRow {
  return item.entry.card;
}

export function dailyItemBankItem(item: DailyItem): BankItemRow {
  return item.entry.item;
}

/** Overfetch factor (T06 pattern): some due cards get skipped (no item, no translation). */
const OVERFETCH = 3;

/**
 * Largest-remainder apportionment of `slots` across modes by weight.
 * All-zero weights are treated as all-ones (never a zero-item plan).
 * Deterministic: ties broken by DAILY_MODES order.
 */
export function planTargets(weights: Record<DailyMode, number>, slots: number) {
  const total = DAILY_MODES.reduce((sum, m) => sum + weights[m], 0);
  const effective =
    total > 0
      ? weights
      : (Object.fromEntries(DAILY_MODES.map((m) => [m, 1])) as Record<DailyMode, number>);
  const effectiveTotal = DAILY_MODES.reduce((sum, m) => sum + effective[m], 0);

  const targets = {} as Record<DailyMode, number>;
  const remainders: { mode: DailyMode; frac: number }[] = [];
  let assigned = 0;
  for (const mode of DAILY_MODES) {
    const quota = (slots * effective[mode]) / effectiveTotal;
    targets[mode] = Math.floor(quota);
    assigned += targets[mode];
    remainders.push({ mode, frac: quota - targets[mode] });
  }
  remainders.sort(
    (a, b) => b.frac - a.frac || DAILY_MODES.indexOf(a.mode) - DAILY_MODES.indexOf(b.mode),
  );
  for (let i = 0; i < slots - assigned; i++) {
    targets[remainders[i % remainders.length]!.mode] += 1;
  }
  return targets;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Composition summary (Zod-checked before it leaves as analytics — DoD boundary). */
const CompositionSummarySchema = z.record(z.enum(DAILY_MODES), z.number().int().min(0));

export interface DailySessionOpts {
  length?: number;
  weights?: DailyWeights;
  unseenAllowed?: boolean;
  now?: number;
  /**
   * T18 "practice now": restrict the session to these bank items' cards,
   * due-agnostic (dashboard-flagged weak lemmas may not be due yet — due
   * cards still serve first, then weakest). Composition/weights unchanged.
   */
  focusItemIds?: string[];
}

export async function buildDailySession(
  repos: Repositories,
  opts: DailySessionOpts = {},
): Promise<DailyItem[]> {
  const {
    length = DEFAULT_DAILY_PREFS.length,
    weights = DEFAULT_DAILY_PREFS.weights,
    unseenAllowed = false,
    now = Date.now(),
    focusItemIds,
  } = opts;

  const rawWeights = Object.fromEntries(
    DAILY_MODES.map((m) => [m, weightForMode(weights, m)]),
  ) as Record<DailyMode, number>;
  // All-zero weights heal to all-ones once, up front — every later decision
  // (pool gating, targets, text re-apportionment) sees the healed values.
  const anyWeight = DAILY_MODES.some((m) => rawWeights[m] > 0);
  const modeWeights = anyWeight
    ? rawWeights
    : (Object.fromEntries(DAILY_MODES.map((m) => [m, 1])) as Record<DailyMode, number>);
  const listeningOn = modeWeights.listening > 0;
  const textOn =
    modeWeights.flashcard + modeWeights.mc + modeWeights.cloze + modeWeights['sentence-builder'] >
    0;

  const due = focusItemIds
    ? await repos.reviews.listCardsForItems(focusItemIds, UNIFIED_SESSION_DIRECTIONS, now)
    : await repos.reviews.listDueCards({
        now,
        limit: length * OVERFETCH,
        directions: UNIFIED_SESSION_DIRECTIONS,
      });
  const items = await repos.bank.getItemsByIds([...new Set(due.map((c) => c.bankItemId))]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const listeningPool: { card: CardRow; item: BankItemRow }[] = [];
  const textPool: { card: CardRow; item: BankItemRow }[] = [];
  for (const card of due) {
    const item = itemById.get(card.bankItemId);
    if (!item) continue;
    if (card.direction === 'listening') {
      // The prompt is the Russian side (audio) — unenriched items still play.
      if (listeningOn) listeningPool.push({ card, item });
    } else if (textOn && item.translation.trim().length > 0) {
      // T06 rule: flashcard/MC/cloze/SB all need the gloss; unenriched wait for T16.
      textPool.push({ card, item });
    }
  }

  const slots = Math.min(length, listeningPool.length + textPool.length);
  if (slots === 0) return [];

  const targets = planTargets(modeWeights, slots);

  // Listening serve count: its target, grown to cover slots text can't fill,
  // capped by what's actually due; text takes the rest.
  let listeningServe = Math.min(
    listeningPool.length,
    Math.max(targets.listening, slots - textPool.length),
  );
  const textServe = Math.min(textPool.length, slots - listeningServe);
  listeningServe = Math.min(listeningPool.length, slots - textServe);

  const session: DailyItem[] = [];

  for (const [i, { card, item }] of listeningPool.slice(0, listeningServe).entries()) {
    const wantVariant: ListeningVariant = i % 2 === 0 ? 'pick4' : 'typed';
    session.push({
      mode: 'listening',
      entry: await buildListeningItemForCard(repos, card, item, wantVariant, { unseenAllowed }),
    });
  }

  // Text slots: re-apportion the non-listening share across the four text
  // modes, then walk the most-overdue cards trying each card's best mode —
  // highest remaining target first, sentence games ahead on ties (their
  // eligibility is the scarce resource), flashcard as the always-works floor.
  // Safe from planTargets' all-zero healing: textServe > 0 implies textOn.
  const textTargets = planTargets({ ...modeWeights, listening: 0 }, textServe);
  const textModes: DailyMode[] = ['cloze', 'sentence-builder', 'mc', 'flashcard'];
  const readIndex = textServe > 0 ? await buildReadIndex(repos) : null;
  /** One sentence-quoting game per bank item per session (two directions due). */
  const sentenceGameServed = new Set<string>();
  let clozeCount = 0;

  for (const { card, item } of textPool.slice(0, textServe)) {
    const ordered = [...textModes].sort(
      (a, b) => textTargets[b] - textTargets[a] || textModes.indexOf(a) - textModes.indexOf(b),
    );
    let built: DailyItem | null = null;
    for (const mode of ordered) {
      if (textTargets[mode] <= 0) continue;
      built = await tryBuildTextItem(repos, mode, card, item, {
        readIndex: readIndex!,
        unseenAllowed,
        sentenceGameServed,
        clozeVariant: clozeCount % 2 === 0 ? 'tiles' : 'typed',
      });
      if (built) {
        textTargets[mode] -= 1;
        break;
      }
    }
    if (!built) {
      // Every targeted mode failed (or targets ran dry) — flashcard floor.
      built = {
        mode: 'flashcard',
        entry: { card, item, direction: card.direction, mode: 'flashcard' },
      };
      textTargets.flashcard -= 1;
    }
    if (built.mode === 'cloze') clozeCount += 1;
    if (built.mode === 'cloze' || built.mode === 'sentence-builder') {
      sentenceGameServed.add(item.id);
    }
    session.push(built);
  }

  const composed = spreadSameItem(
    shuffle(session).map((wrapped) => ({ item: dailyItemBankItem(wrapped), wrapped })),
  ).map((w) => w.wrapped);

  const summary = Object.fromEntries(DAILY_MODES.map((m) => [m, 0])) as Record<DailyMode, number>;
  for (const entry of composed) summary[entry.mode] += 1;
  track('daily_session_composed', {
    ...CompositionSummarySchema.parse(summary),
    requested: length,
    served: composed.length,
    dueSeen: due.length,
  });

  return composed;
}

async function tryBuildTextItem(
  repos: Repositories,
  mode: DailyMode,
  card: CardRow,
  item: BankItemRow,
  ctx: {
    readIndex: ReadIndex;
    unseenAllowed: boolean;
    sentenceGameServed: Set<string>;
    clozeVariant: 'tiles' | 'typed';
  },
): Promise<DailyItem | null> {
  switch (mode) {
    case 'cloze': {
      if (ctx.sentenceGameServed.has(item.id)) return null;
      const entry = await buildClozeItemForCard(repos, card, item, ctx.readIndex, {
        unseenAllowed: ctx.unseenAllowed,
        wantVariant: ctx.clozeVariant,
      });
      return entry ? { mode: 'cloze', entry } : null;
    }
    case 'sentence-builder': {
      if (ctx.sentenceGameServed.has(item.id)) return null;
      const entry = await buildSbItemForCard(repos, card, item, ctx.readIndex, {
        unseenAllowed: ctx.unseenAllowed,
      });
      return entry ? { mode: 'sentence-builder', entry } : null;
    }
    case 'mc': {
      const choices = await buildMcChoices(repos, item, card.direction);
      return choices
        ? { mode: 'mc', entry: { card, item, direction: card.direction, mode: 'mc', choices } }
        : null;
    }
    case 'flashcard':
      return {
        mode: 'flashcard',
        entry: { card, item, direction: card.direction, mode: 'flashcard' },
      };
    default:
      return null;
  }
}
