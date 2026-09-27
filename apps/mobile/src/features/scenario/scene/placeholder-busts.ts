import type { ColorTokens } from '@/theme/colors';

import { PLACEHOLDER_MOUTH_ANCHOR } from './scene-geometry';

/**
 * The placeholder cast's geometry (T61, §8.3) — pure SVG primitives, no RN
 * imports, so the node budget (≤ 40 per bust) is a unit test. Four busts
 * share one 300×400 canvas (3:4, the body-layer aspect) and the standard
 * mouth anchor (`PLACEHOLDER_MOUTH_ANCHOR`); the hue comes from
 * `portrait.placeholder.hue`, the shading from theme tokens. The brows,
 * irises and lids are separate layers so the poses (§8.1 item 6) and the
 * blink can move them from Animated wrappers without touching the base.
 */

export type PlaceholderKind = 'woman' | 'man' | 'youth' | 'elder';

export const PLACEHOLDER_KINDS: readonly PlaceholderKind[] = ['woman', 'man', 'youth', 'elder'];

export const BUST_CANVAS = { w: 300, h: 400 } as const;

/** Hard budget from §8.3. */
export const BUST_MAX_NODES = 40;

export type BustLayer = 'base' | 'brows' | 'irises' | 'lids';

export type BustNode =
  | {
      tag: 'path';
      layer: BustLayer;
      d: string;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      tag: 'ellipse';
      layer: BustLayer;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
    };

export interface BustPalette {
  skin: string;
  skinShade: string;
  hair: string;
  cloth: string;
  clothShade: string;
  eyeWhite: string;
  iris: string;
  pupil: string;
  line: string;
  rim: string;
}

/** HSL → `#RRGGBB` (pure; the placeholder is the one place a hue is a colour input). */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.min(1, Math.max(0, s));
  const ll = Math.min(1, Math.max(0, l));
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    const a = ss * Math.min(ll, 1 - ll);
    const c = ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Mix two `#RRGGBB` colours (`t` toward `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const m = (i: number) =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${m(1)}${m(3)}${m(5)}`;
}

/**
 * Hue-driven palette with token-derived shading: skin and cloth take the
 * hue at different saturations/lightness; shadows mix toward the scrim,
 * highlights toward the text token; the rim light is the scene glow.
 */
export function bustPalette(hue: number, tokens: ColorTokens, glow: string): BustPalette {
  const skin = hslToHex(hue, 0.28, 0.6);
  const cloth = hslToHex(hue, 0.22, 0.24);
  return {
    skin,
    skinShade: mixHex(skin, tokens.scrim, 0.28),
    hair: mixHex(hslToHex(hue, 0.3, 0.16), tokens.scrim, 0.35),
    cloth,
    clothShade: mixHex(cloth, tokens.scrim, 0.4),
    eyeWhite: mixHex(tokens.text, skin, 0.15),
    iris: mixHex(hslToHex(hue + 150, 0.35, 0.3), tokens.scrim, 0.2),
    pupil: tokens.scrim,
    line: mixHex(skin, tokens.scrim, 0.55),
    rim: glow,
  };
}

// Shared face metrics (canvas 300×400): head centred at (150, 150).
const HEAD = { cx: 150, cy: 150, rx: 62, ry: 74 };
const EYE_Y = 140;
const EYE_DX = 26;
const EYE_RX = 11;
const EYE_RY = 6.5;
const BROW_Y = 121;

function shoulders(p: BustPalette, width: number, collar: 'crew' | 'blazer' | 'hood' | 'cardigan') {
  const nodes: BustNode[] = [];
  const l = 150 - width;
  const r = 150 + width;
  nodes.push({
    tag: 'path',
    layer: 'base',
    d: `M${l} 400 L${l} 330 Q${l} 284 ${l + 60} 270 L120 258 L180 258 L${r - 60} 270 Q${r} 284 ${r} 330 L${r} 400 Z`,
    fill: p.cloth,
  });
  if (collar === 'blazer') {
    nodes.push({
      tag: 'path',
      layer: 'base',
      d: 'M118 258 L150 318 L182 258 L170 262 L150 300 L130 262 Z',
      fill: p.clothShade,
    });
  } else if (collar === 'hood') {
    nodes.push({
      tag: 'path',
      layer: 'base',
      d: `M${l + 24} 300 Q150 250 ${r - 24} 300 Q150 336 ${l + 24} 300 Z`,
      fill: p.clothShade,
    });
  } else if (collar === 'cardigan') {
    nodes.push({
      tag: 'path',
      layer: 'base',
      d: 'M124 258 L150 352 L176 258 L166 262 L150 330 L134 262 Z',
      fill: p.clothShade,
    });
  } else {
    nodes.push({
      tag: 'path',
      layer: 'base',
      d: 'M118 258 Q150 286 182 258 Q150 272 118 258 Z',
      fill: p.clothShade,
    });
  }
  return nodes;
}

function neck(p: BustPalette, w: number): BustNode[] {
  return [
    {
      tag: 'path',
      layer: 'base',
      d: `M${150 - w} 196 L${150 - w} 268 L${150 + w} 268 L${150 + w} 196 Z`,
      fill: p.skinShade,
    },
  ];
}

function head(p: BustPalette, jaw: 'soft' | 'square'): BustNode[] {
  const nodes: BustNode[] = [
    { tag: 'ellipse', layer: 'base', cx: 88, cy: 152, rx: 9, ry: 13, fill: p.skinShade },
    { tag: 'ellipse', layer: 'base', cx: 212, cy: 152, rx: 9, ry: 13, fill: p.skinShade },
    { tag: 'ellipse', layer: 'base', ...HEAD, fill: p.skin },
  ];
  if (jaw === 'square') {
    nodes.push({
      tag: 'path',
      layer: 'base',
      d: 'M94 160 L96 206 Q150 236 204 206 L206 160 Q150 176 94 160 Z',
      fill: p.skin,
    });
  }
  // Cheek/jaw shade — one soft crescent low on the face.
  nodes.push({
    tag: 'path',
    layer: 'base',
    d: 'M96 178 Q150 240 204 178 Q150 218 96 178 Z',
    fill: p.skinShade,
  });
  // Rim light along the lit edge (§8.3: "a soft rim light … carry it").
  nodes.push({
    tag: 'path',
    layer: 'base',
    d: 'M196 92 Q214 138 200 196 Q222 144 196 92 Z',
    fill: p.rim,
  });
  return nodes;
}

function eyes(p: BustPalette): BustNode[] {
  const nodes: BustNode[] = [];
  for (const dx of [-EYE_DX, EYE_DX]) {
    const cx = 150 + dx;
    nodes.push({
      tag: 'ellipse',
      layer: 'base',
      cx,
      cy: EYE_Y,
      rx: EYE_RX,
      ry: EYE_RY,
      fill: p.eyeWhite,
    });
    nodes.push({ tag: 'ellipse', layer: 'irises', cx, cy: EYE_Y, rx: 5.5, ry: 5.5, fill: p.iris });
    nodes.push({ tag: 'ellipse', layer: 'irises', cx, cy: EYE_Y, rx: 2.4, ry: 2.4, fill: p.pupil });
    // Closed lid: a skin-coloured lens over the eye + a lash line.
    nodes.push({
      tag: 'ellipse',
      layer: 'lids',
      cx,
      cy: EYE_Y,
      rx: EYE_RX + 1.5,
      ry: EYE_RY + 1.5,
      fill: p.skin,
    });
    nodes.push({
      tag: 'path',
      layer: 'lids',
      d: `M${cx - EYE_RX} ${EYE_Y} Q${cx} ${EYE_Y + 6} ${cx + EYE_RX} ${EYE_Y}`,
      fill: 'none',
      stroke: p.line,
      strokeWidth: 1.6,
    });
  }
  return nodes;
}

function brows(p: BustPalette, thickness: number, arch: number): BustNode[] {
  const nodes: BustNode[] = [];
  for (const dx of [-EYE_DX, EYE_DX]) {
    const cx = 150 + dx;
    nodes.push({
      tag: 'path',
      layer: 'brows',
      d: `M${cx - 14} ${BROW_Y + 2} Q${cx} ${BROW_Y - arch} ${cx + 14} ${BROW_Y + 2}`,
      fill: 'none',
      stroke: p.hair,
      strokeWidth: thickness,
    });
  }
  return nodes;
}

function hairWoman(p: BustPalette): BustNode[] {
  return [
    // Long hair behind the head, down to the shoulders.
    {
      tag: 'path',
      layer: 'base',
      d: 'M84 130 Q76 220 96 290 L204 290 Q224 220 216 130 Q150 40 84 130 Z',
      fill: p.hair,
    },
    // Cap + side-swept fringe.
    {
      tag: 'path',
      layer: 'base',
      d: 'M88 140 Q86 74 150 72 Q214 74 212 140 Q196 96 150 106 Q128 92 110 118 Q100 124 88 140 Z',
      fill: p.hair,
    },
  ];
}

function hairMan(p: BustPalette): BustNode[] {
  return [
    {
      tag: 'path',
      layer: 'base',
      d: 'M88 132 Q88 70 150 70 Q212 70 212 132 Q196 104 150 100 Q104 104 88 132 Z',
      fill: p.hair,
    },
  ];
}

function hairYouth(p: BustPalette): BustNode[] {
  return [
    // Messy cap with a fringe that breaks over the brow.
    {
      tag: 'path',
      layer: 'base',
      d: 'M86 138 Q80 64 150 66 Q220 64 214 138 L204 114 L190 126 L176 104 L160 122 L144 100 L128 122 L112 108 L100 128 Z',
      fill: p.hair,
    },
  ];
}

function hairElder(p: BustPalette, grey: string): BustNode[] {
  return [
    // Receded: two side tufts and a thin crown.
    { tag: 'path', layer: 'base', d: 'M88 150 Q84 108 106 96 Q96 122 100 150 Z', fill: grey },
    { tag: 'path', layer: 'base', d: 'M212 150 Q216 108 194 96 Q204 122 200 150 Z', fill: grey },
    { tag: 'path', layer: 'base', d: 'M110 92 Q150 76 190 92 Q150 86 110 92 Z', fill: grey },
    // Two age lines.
    {
      tag: 'path',
      layer: 'base',
      d: 'M112 172 Q120 184 128 190',
      fill: 'none',
      stroke: p.line,
      strokeWidth: 1.4,
    },
    {
      tag: 'path',
      layer: 'base',
      d: 'M188 172 Q180 184 172 190',
      fill: 'none',
      stroke: p.line,
      strokeWidth: 1.4,
    },
  ];
}

/** The bust's SVG nodes, bottom → top within each layer. */
export function bustNodes(kind: PlaceholderKind, p: BustPalette): BustNode[] {
  switch (kind) {
    case 'woman':
      return [
        ...hairWoman(p).slice(0, 1),
        ...shoulders(p, 118, 'blazer'),
        ...neck(p, 18),
        ...head(p, 'soft'),
        ...hairWoman(p).slice(1),
        ...eyes(p),
        ...brows(p, 3, 8),
      ];
    case 'man':
      return [
        ...shoulders(p, 132, 'crew'),
        ...neck(p, 24),
        ...head(p, 'square'),
        ...hairMan(p),
        ...eyes(p),
        ...brows(p, 4.5, 4),
      ];
    case 'youth':
      return [
        ...shoulders(p, 124, 'hood'),
        ...neck(p, 20),
        ...head(p, 'soft'),
        ...hairYouth(p),
        ...eyes(p),
        ...brows(p, 3.5, 6),
      ];
    case 'elder':
      return [
        ...shoulders(p, 120, 'cardigan'),
        ...neck(p, 20),
        ...head(p, 'square'),
        ...hairElder(p, mixHex(p.hair, '#d8d4cc', 0.7)),
        ...eyes(p),
        ...brows(p, 4, 2),
      ];
  }
}

/** Where the mouth goes on every bust, as fractions of the canvas (= the body rect). */
export const PLACEHOLDER_ANCHOR = PLACEHOLDER_MOUTH_ANCHOR;

/** The nodes of one layer only. */
export function layerNodes(nodes: readonly BustNode[], layer: BustLayer): BustNode[] {
  return nodes.filter((n) => n.layer === layer);
}
