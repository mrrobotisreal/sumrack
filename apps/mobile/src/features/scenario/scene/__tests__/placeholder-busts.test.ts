import { describe, expect, it } from 'vitest';

import { colors } from '@/theme/colors';

import {
  BUST_MAX_NODES,
  bustNodes,
  bustPalette,
  hslToHex,
  layerNodes,
  mixHex,
  PLACEHOLDER_KINDS,
} from '../placeholder-busts';

const palette = bustPalette(25, colors.dark, colors.dark.accent);

describe('placeholder busts (§8.3)', () => {
  it.each(PLACEHOLDER_KINDS)('%s stays within the 40-node budget', (kind) => {
    const nodes = bustNodes(kind, palette);
    expect(nodes.length).toBeLessThanOrEqual(BUST_MAX_NODES);
    expect(nodes.length).toBeGreaterThan(12);
  });

  it.each(PLACEHOLDER_KINDS)('%s has two eyes, two irises, two lids and two brows', (kind) => {
    const nodes = bustNodes(kind, palette);
    expect(layerNodes(nodes, 'brows')).toHaveLength(2);
    expect(layerNodes(nodes, 'irises')).toHaveLength(4); // iris + pupil × 2
    expect(layerNodes(nodes, 'lids')).toHaveLength(4); // lens + lash × 2
  });

  it('every node is a path or an ellipse with a colour', () => {
    for (const kind of PLACEHOLDER_KINDS) {
      for (const n of bustNodes(kind, palette)) {
        expect(['path', 'ellipse']).toContain(n.tag);
        expect(n.fill).toMatch(/^(#[0-9a-fA-F]{6}|none)$/);
        if (n.tag === 'path') expect(n.d).toMatch(/^M/);
      }
    }
  });

  it('the four kinds differ (hair/collar) but share the eye rows', () => {
    const sigs = PLACEHOLDER_KINDS.map((k) =>
      bustNodes(k, palette)
        .filter((n) => n.layer === 'base')
        .map((n) => (n.tag === 'path' ? n.d : `${n.cx},${n.cy}`))
        .join('|'),
    );
    expect(new Set(sigs).size).toBe(4);
    const eyeRows = PLACEHOLDER_KINDS.map((k) =>
      layerNodes(bustNodes(k, palette), 'irises')
        .map((n) => (n.tag === 'ellipse' ? n.cy : -1))
        .join(','),
    );
    expect(new Set(eyeRows).size).toBe(1);
  });
});

describe('palette derivation', () => {
  it('hslToHex covers the primaries', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(-120, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(0, 0, 1)).toBe('#ffffff');
  });

  it('mixHex interpolates channel-wise', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('a hue drives skin/cloth, tokens drive the shading, the glow is the rim', () => {
    const warm = bustPalette(25, colors.dark, '#c26a3a');
    const cool = bustPalette(220, colors.dark, '#c26a3a');
    expect(warm.skin).not.toBe(cool.skin);
    expect(warm.rim).toBe('#c26a3a');
    expect(warm.pupil).toBe(colors.dark.scrim);
    for (const v of Object.values(warm)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
