import type { ColorTokens } from '@/theme/colors';

/**
 * Scene color derivation (T31, V2 §5.3): every scene color comes from theme
 * tokens plus the pack's optional `theme.accent` — never a hardcoded scene
 * palette. Pure module (no RN imports) so it stays unit-testable.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface ScenePalette {
  /** Primary light source / tint — the pack accent when valid, else the theme ember. */
  glow: string;
  /** Deep shadow wash base (the scrim token, used with alpha). */
  shadow: string;
  /** The background the scene sits on (bg token). */
  bg: string;
  /** Faint neutral element color (dust, fog, static) — the text-muted token. */
  mist: string;
}

export function scenePalette(tokens: ColorTokens, packAccent?: string | null): ScenePalette {
  const glow = packAccent != null && HEX_RE.test(packAccent) ? packAccent : tokens.accent;
  return { glow, shadow: tokens.scrim, bg: tokens.bg, mist: tokens.textMuted };
}

/** `#RRGGBB` + alpha → `rgba()` — for SVG stops and gradient colors. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The six scene ids — MUST stay in sync with HOUSE_ROOMS (rooms.ts is the
 * room-identity registry; this is asserted in scenes.test.ts). Kept as a
 * separate pure constant so tests never import component modules.
 */
export const SCENE_IDS = [
  'hallway',
  'living-room',
  'kitchen',
  'pantry',
  'nursery',
  'cellar',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/**
 * Each scene's dominant loop period in ms — the V2 §5.3 motion budget is
 * 8–20 s. Components build their primary loops from these constants; the
 * test asserts every value stays inside the budget.
 */
export const SCENE_PRIMARY_LOOP_MS: Record<SceneId, number> = {
  hallway: 9300, // irregular lamp flicker sequence
  'living-room': 12600, // curtain sway period
  kitchen: 9400, // bulb swing period
  pantry: 12000, // breathing-darkness in/out
  nursery: 20000, // one full mobile rotation
  cellar: 18600, // fog-band drift there-and-back
};

/** Threshold transition budgets (≤800 ms per V2 §5.3). */
export const THRESHOLD_ENTER_MS = 650;
export const THRESHOLD_EXIT_MS = 360;
