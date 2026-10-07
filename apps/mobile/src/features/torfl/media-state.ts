import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';

import {
  parseExamMediaLedger,
  type ExamBundleEntry,
  type ExamBundleState,
  type ExamMediaLedger,
} from './media-state-core';

/**
 * Read/write path over `torfl.media` (T74, TORFL §8.5). One row, healed on
 * every read; writes are read-modify-write on the main JS thread (the bundle
 * service serializes per attempt, the pump runs one at a time).
 */

export async function getExamMediaLedger(): Promise<ExamMediaLedger> {
  return parseExamMediaLedger(await repos.settings.get<unknown>(SETTING_KEYS.torflMedia));
}

export async function getExamBundle(attemptId: string): Promise<ExamBundleEntry | null> {
  return (await getExamMediaLedger()).attempts[attemptId] ?? null;
}

export async function setExamBundle(
  attemptId: string,
  state: ExamBundleState,
  name: string,
): Promise<void> {
  const ledger = await getExamMediaLedger();
  ledger.attempts[attemptId] = { state, name };
  await repos.settings.set(SETTING_KEYS.torflMedia, ledger);
}

/** Forget attempts (cascade-aware callers: the dev fixture delete). */
export async function forgetExamBundles(attemptIds: readonly string[]): Promise<void> {
  if (attemptIds.length === 0) return;
  const ledger = await getExamMediaLedger();
  for (const id of attemptIds) delete ledger.attempts[id];
  await repos.settings.set(SETTING_KEYS.torflMedia, ledger);
}

/** Attempt ids in a given state (the pump), or with no entry when `state` is null. */
export async function listExamBundleIds(state: ExamBundleState): Promise<string[]> {
  const ledger = await getExamMediaLedger();
  return Object.entries(ledger.attempts)
    .filter(([, e]) => e.state === state)
    .map(([id]) => id);
}

export async function countExamBundles(): Promise<{
  uploaded: number;
  pending: number;
  failed: number;
}> {
  const ledger = await getExamMediaLedger();
  const out = { uploaded: 0, pending: 0, failed: 0 };
  for (const e of Object.values(ledger.attempts)) out[e.state] += 1;
  return out;
}
