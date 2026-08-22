import type { BankItemRow } from '@/db/repositories/bank';

import { AiError } from './errors';
import { EnrichmentResponseSchema, extractJsonObject, type EnrichmentProposal } from './schemas';

/**
 * Pure enrichment logic (T16 feature 2) — parsing, sanitizing, context
 * windowing. No DB/network imports; production orchestration (batching,
 * context resolution, apply) lives in enrichment.ts.
 */

/** Per OpenRouter request — keeps completions comfortably inside max_tokens. */
export const ENRICHMENT_BATCH_SIZE = 20;

/** How much surrounding text a context snippet may carry into the prompt. */
const CONTEXT_WINDOW = 90;

/** A ±CONTEXT_WINDOW slice of `text` around the first hit of `needle`. */
export function windowAround(text: string, needle: string): string | undefined {
  const haystack = text.normalize('NFC');
  const at = haystack.toLowerCase().indexOf(needle.normalize('NFC').toLowerCase());
  if (at === -1) return haystack.slice(0, CONTEXT_WINDOW * 2) || undefined;
  const start = Math.max(0, at - CONTEXT_WINDOW);
  const end = Math.min(haystack.length, at + needle.length + CONTEXT_WINDOW);
  return haystack.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Sanitize a proposal against its item's kind: phrases never take lemma/
 * pos (design §5 — phrase rows keep those null); a word proposal missing
 * a lemma falls back to the item's current (provisional) lemma.
 */
export function sanitizeProposal(
  item: Pick<BankItemRow, 'kind' | 'lemma' | 'surface'>,
  proposal: EnrichmentProposal,
): EnrichmentProposal {
  if (item.kind === 'phrase') {
    const { lemma: _l, pos: _p, ...rest } = proposal;
    return rest;
  }
  return { ...proposal, lemma: proposal.lemma ?? item.lemma ?? item.surface };
}

/** Parse one batch completion → proposals keyed by id, unknown ids dropped. */
export function parseEnrichmentCompletion(
  content: string,
  requested: Pick<BankItemRow, 'id' | 'kind' | 'lemma' | 'surface'>[],
): Map<string, EnrichmentProposal> {
  const json = extractJsonObject(content);
  const parsed = EnrichmentResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiError('invalid-response', 'enrichment did not match the expected shape');
  }
  const byId = new Map(requested.map((item) => [item.id, item]));
  const proposals = new Map<string, EnrichmentProposal>();
  for (const raw of parsed.data.items) {
    const item = byId.get(raw.id);
    if (!item) continue; // hallucinated or duplicate id — drop
    if (!proposals.has(raw.id)) proposals.set(raw.id, sanitizeProposal(item, raw));
  }
  return proposals;
}
