import { describe, expect, it, vi } from 'vitest';

import {
  formatCost,
  formatDuration,
  formatReceiptDate,
  formatReceiptLine,
  gridScrollsHorizontally,
  initialExpanded,
  modelHintFor,
  sectionOrder,
  sectionTitle,
  tagStyle,
  toggleExpanded,
} from '../format';
import { SECTION_CATALOG } from '../profile-core';
import type { ProfileSection } from '../profile-schema';
import { verbProfile } from './fixtures';

// `format.ts` reads only the label tables from the run profile, but that
// module touches `@/db` at import time (the settings repo) — stub it so the
// test stays a pure Node test (no expo-sqlite). `vi.mock` is hoisted.
vi.mock('@/db', () => ({ repos: {} }));
vi.mock('expo-secure-store', () => ({}));

const receipt = {
  createdAt: new Date(2026, 8, 24, 14, 5).getTime(),
  provider: 'anthropic' as const,
  model: 'anthropic/claude-opus-5.5',
  quality: 'normal' as const,
  effort: 'high' as const,
  effortApplied: true,
  costUsd: 0.1834,
  durationMs: 64_900,
};

describe('formatReceiptLine (§7.2 versions row)', () => {
  it('renders date · Provider · MODEL_HINT · Quality · Effort · $cost · seconds', () => {
    expect(formatReceiptLine(receipt)).toBe(
      '24 Sep 2026 14:05 · Anthropic · Claude Opus 5.5 · Normal · High · $0.18 · 65 s',
    );
  });
  it('shows «effort n/a» when the effort param was rejected (§8)', () => {
    expect(formatReceiptLine({ ...receipt, effortApplied: false })).toContain('· effort n/a ·');
  });
  it('falls back to the slug when the model is not the default for the notch', () => {
    expect(modelHintFor('openai', 'fast', 'openai/gpt-6-sol')).toBe('GPT-6 Sol');
    expect(modelHintFor('openai', 'fast', 'openai/gpt-7-preview')).toBe('openai/gpt-7-preview');
    expect(formatReceiptLine({ ...receipt, model: 'anthropic/other' })).toContain(
      'anthropic/other',
    );
  });
  it('formats cost and duration edge cases', () => {
    expect(formatCost(null)).toBe('cost n/a');
    expect(formatCost(0.004)).toBe('< $0.01');
    expect(formatCost(0.04)).toBe('$0.04');
    expect(formatDuration(2_400)).toBe('2.4 s');
    expect(formatDuration(62_700)).toBe('63 s');
    expect(formatReceiptDate(new Date(2026, 0, 3, 9, 7).getTime())).toBe('3 Jan 2026 09:07');
  });
});

describe('sectionOrder (§5.3 catalog order, x- last)', () => {
  const sec = (id: string): ProfileSection => ({
    id,
    title: { en: id, ru: id },
    layout: 'list',
    rows: [{ ru: 'а', plain: 'а', gloss: 'g' }],
  });

  it('sorts catalog ids by catalog index regardless of input order', () => {
    const shuffled = { sections: [sec('verb-family'), sec('verb-past'), sec('verb-nonpast')] };
    expect(sectionOrder(shuffled).map((s) => s.id)).toEqual([
      'verb-nonpast',
      'verb-past',
      'verb-family',
    ]);
  });
  it('puts x- sections after every catalog section, keeping their own order', () => {
    const p = { sections: [sec('x-zeta'), sec('phrase-variants'), sec('x-alpha'), sec('usage')] };
    expect(sectionOrder(p).map((s) => s.id)).toEqual([
      'usage',
      'phrase-variants',
      'x-zeta',
      'x-alpha',
    ]);
  });
  it('keeps a valid verb fixture unchanged (already in catalog order)', () => {
    const p = verbProfile();
    expect(sectionOrder(p).map((s) => s.id)).toEqual(p.sections.map((s) => s.id));
    const catalogIds = SECTION_CATALOG.map((e) => e.id);
    const idx = sectionOrder(p).map((s) => catalogIds.indexOf(s.id));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('uses the catalog title for known ids and the model title otherwise', () => {
    expect(sectionTitle(sec('verb-nonpast')).en).toBe('Present & future');
    expect(sectionTitle(sec('x-idioms')).en).toBe('x-idioms');
  });
});

describe('tagStyle (§7.2 pills)', () => {
  it('maps the named tags to their tones', () => {
    expect(tagStyle('pf').text).toBe('text-accent');
    expect(tagStyle('impf').text).toBe('text-level-a1');
    expect(tagStyle('partner').text).toBe('text-accent');
    expect(tagStyle('refl').text).toBe('text-level-a2');
  });
  it('strips the prefix: namespace and mutes it', () => {
    expect(tagStyle('prefix:по-')).toEqual({
      bg: 'bg-surface-2',
      text: 'text-text-muted',
      label: 'по-',
    });
  });
  it('mutes unknown tags with their own label', () => {
    expect(tagStyle('colloquial')).toMatchObject({ text: 'text-text-muted', label: 'colloquial' });
  });
});

describe('expanded-set reducer', () => {
  it('starts with the first two sections expanded', () => {
    expect([...initialExpanded(['a', 'b', 'c'])]).toEqual(['a', 'b']);
    expect([...initialExpanded(['only'])]).toEqual(['only']);
  });
  it('toggles immutably', () => {
    const s0 = initialExpanded(['a', 'b', 'c']);
    const s1 = toggleExpanded(s0, 'c');
    expect(s1).not.toBe(s0);
    expect(s1.has('c')).toBe(true);
    const s2 = toggleExpanded(s1, 'a');
    expect(s2.has('a')).toBe(false);
    expect(s0.has('a')).toBe(true);
  });
});

describe('gridScrollsHorizontally', () => {
  it('is true only for wide grids (adjectives), not the 2-column noun/verb ones', () => {
    expect(gridScrollsHorizontally(['Singular', 'Plural'])).toBe(false);
    expect(gridScrollsHorizontally(['Masc.', 'Fem.', 'Neut.', 'Plural'])).toBe(true);
    expect(gridScrollsHorizontally(['Form'])).toBe(false);
  });
});
