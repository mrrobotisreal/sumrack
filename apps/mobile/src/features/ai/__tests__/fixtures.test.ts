import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEnrichmentCompletion } from '../enrichment-core';
import { buildEnrichmentMessages } from '../prompts/enrichment';
import { buildExplainMessages } from '../prompts/explain';
import { buildJournalFeedbackMessages } from '../prompts/journal-feedback';
import { parseFeedbackCompletion } from '../queue-core';
import { ExplainResponseSchema, parseStoredFeedback } from '../schemas';

/**
 * Recorded-fixture tests (ticket item 6): real OpenRouter responses
 * captured once by scripts/capture-ai-fixtures.ts, checked in, parsed here
 * with the exact production parsers — no live API in CI. If a prompt
 * template changes its response contract, regenerate the fixtures.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

describe('prompt templates', () => {
  it('journal feedback: system pins the JSON contract, user carries the entry', () => {
    const messages = buildJournalFeedbackMessages('Я идти домой.');
    expect(messages[0]!.role).toBe('system');
    for (const key of ['"corrected"', '"changes"', '"before"', '"after"', '"summary"']) {
      expect(messages[0]!.content).toContain(key);
    }
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'My journal entry:\n\nЯ идти домой.',
    });
  });

  it('enrichment: every item id and field reaches the user message', () => {
    const messages = buildEnrichmentMessages([
      { id: 'a1', kind: 'word', surface: 'словами', context: 'простыми словами' },
      { id: 'b2', kind: 'phrase', surface: 'по крайней мере', translation: 'at least' },
    ]);
    const user = messages[1]!.content;
    expect(user).toContain('id: a1');
    expect(user).toContain('kind: word');
    expect(user).toContain('context: …простыми словами…');
    expect(user).toContain('id: b2');
    expect(user).toContain('user translation: at least');
    expect(messages[0]!.content).toContain('"items"');
  });

  it('explain: sentence and card variants render their context lines', () => {
    const sentence = buildExplainMessages({
      kind: 'sentence',
      ru: 'Ночью я слышу стук.',
      en: 'At night I hear a knock.',
      sourceTitle: 'Стук в стене',
    });
    expect(sentence[1]!.content).toContain('«Ночью я слышу стук.»');
    expect(sentence[1]!.content).toContain('Стук в стене');

    const card = buildExplainMessages({
      kind: 'card',
      headword: 'зеркало',
      translation: 'mirror',
      pos: 'noun',
      exampleRu: 'Мы купили странное зеркало.',
    });
    expect(card[1]!.content).toContain('«зеркало»');
    expect(card[1]!.content).toContain('Мы купили странное зеркало.');
  });
});

describe('recorded fixtures parse with the production parsers', () => {
  it('journal feedback → StoredFeedback, and survives a DB round-trip', () => {
    const fx = fixture<{ entryRu: string; model: string; content: string }>(
      'journal-feedback.json',
    );
    const stored = parseFeedbackCompletion(fx.content, fx.entryRu, fx.model, 1_000);
    expect(stored.v).toBe(1);
    expect(stored.sourceRu).toBe(fx.entryRu);
    expect(stored.corrected.length).toBeGreaterThan(0);
    expect(stored.changes.length).toBeGreaterThan(0);
    for (const change of stored.changes) {
      expect(change.explanation.length).toBeGreaterThan(0);
    }
    // the exact string journal_entries.aiFeedback stores must read back
    expect(parseStoredFeedback(JSON.stringify(stored))).toEqual(stored);
  });

  it('enrichment (fence-wrapped in the wild) → proposals for every item', () => {
    const fx = fixture<{
      items: { id: string; kind: 'word' | 'phrase'; surface: string }[];
      content: string;
    }>('enrichment.json');
    const requested = fx.items.map((i) => ({ ...i, lemma: null }));
    const proposals = parseEnrichmentCompletion(fx.content, requested);
    expect(proposals.size).toBe(fx.items.length);
    for (const item of fx.items) {
      const p = proposals.get(item.id)!;
      expect(p.translation.length).toBeGreaterThan(0);
      if (item.kind === 'phrase') {
        expect(p.lemma).toBeUndefined();
        expect(p.pos).toBeUndefined();
      } else {
        expect(p.lemma).toBeTruthy();
      }
    }
  });

  it('explain → non-empty markdown', () => {
    const fx = fixture<{ content: string }>('explain-sentence.json');
    const parsed = ExplainResponseSchema.safeParse(fx.content.trim());
    expect(parsed.success).toBe(true);
  });
});
