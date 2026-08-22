import { repos } from '@/db';
import type { BankItemRow } from '@/db/repositories/bank';

import { ENRICHMENT_BATCH_SIZE, parseEnrichmentCompletion, windowAround } from './enrichment-core';
import { AiError } from './errors';
import { buildEnrichmentMessages, type EnrichmentItemInput } from './prompts/enrichment';
import { runChat } from './runner';
import type { EnrichmentProposal } from './schemas';

/**
 * Batch card enrichment orchestration (ticket feature 2): context lookup,
 * batched requests, and the accept-time apply. This module only PROPOSES —
 * nothing touches the DB until the user explicitly accepts in the review
 * screen (acceptance criterion), and then only via applyProposal.
 * Pure parsing/sanitizing lives in enrichment-core.ts.
 */

/**
 * Best-effort context for one item: its source sentence when the ref still
 * resolves, else a window of the journal entry it was highlighted in.
 * Missing context is fine — the prompt says so.
 */
export async function getEnrichmentContext(item: BankItemRow): Promise<string | undefined> {
  if (item.sourceSentenceId) {
    const resolved = await repos.content.resolveSentence(item.sourceSentenceId);
    if (resolved) return resolved.sentence.ru;
  }
  const detail = await repos.bank.getItemWithEncounters(item.id);
  const journalEncounter = detail?.encounters.find((e) => e.journalEntryId);
  if (journalEncounter?.journalEntryId) {
    const entry = await repos.journal.getEntry(journalEncounter.journalEntryId);
    if (entry) return windowAround(entry.ru, item.surface);
  }
  return undefined;
}

/**
 * Request proposals for all `items`, batched. Batches fail independently;
 * the first error is re-thrown only when NO batch succeeded, so a partial
 * result still reaches review (the screen shows the shortfall).
 */
export async function proposeEnrichment(
  items: BankItemRow[],
): Promise<{ proposals: Map<string, EnrichmentProposal>; failedBatches: number }> {
  const proposals = new Map<string, EnrichmentProposal>();
  let failedBatches = 0;
  let firstError: unknown = null;

  for (let i = 0; i < items.length; i += ENRICHMENT_BATCH_SIZE) {
    const batch = items.slice(i, i + ENRICHMENT_BATCH_SIZE);
    try {
      const inputs: EnrichmentItemInput[] = await Promise.all(
        batch.map(async (item) => ({
          id: item.id,
          kind: item.kind,
          surface: item.surface,
          translation: item.translation || undefined,
          context: await getEnrichmentContext(item),
        })),
      );
      const result = await runChat('enrichment', {
        messages: buildEnrichmentMessages(inputs),
        maxTokens: 4096,
      });
      for (const [id, proposal] of parseEnrichmentCompletion(result.content, batch)) {
        proposals.set(id, proposal);
      }
    } catch (err) {
      failedBatches++;
      firstError = firstError ?? err;
    }
  }
  if (proposals.size === 0 && firstError) throw firstError;
  return { proposals, failedBatches };
}

/**
 * Apply ONE accepted proposal. Only the proposal's present fields update;
 * the enrichment flag clears. A lemma that collides with an existing bank
 * word violates the unique index — surfaced as a friendly error, the item
 * left unchanged (merging bank items is explicitly not this ticket).
 */
export async function applyProposal(
  item: BankItemRow,
  proposal: EnrichmentProposal,
): Promise<void> {
  try {
    await repos.bank.updateItem(item.id, {
      ...(proposal.lemma !== undefined && item.kind === 'word' ? { lemma: proposal.lemma } : {}),
      translation: proposal.translation,
      ...(proposal.grammar !== undefined ? { grammar: proposal.grammar } : {}),
      ...(proposal.pos !== undefined && item.kind === 'word' ? { pos: proposal.pos } : {}),
      ...(proposal.level !== undefined ? { level: proposal.level } : {}),
      needsEnrichment: false,
    });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new AiError(
        'http-client',
        `«${proposal.lemma}» is already in your bank — merge or delete this item manually.`,
      );
    }
    throw err;
  }
}
