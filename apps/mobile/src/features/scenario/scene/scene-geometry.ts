import type { ScenarioScene } from '@sumrak/schema';

/**
 * Scene geometry (T61, SPEAKING_SCENARIOS §8.1) — pure, no RN imports. Every
 * rect is in the SceneBox's own pixel space (measured once — never window
 * dims, the T31 rule). The character's `layout` preset decides where the
 * host stands; the mouth anchor (fractions of the body image) is resolved
 * against the rect the body image really occupies after contain-fitting.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type SceneLayout = ScenarioScene['layout'];

/** Appendix A canvas: body layers are 1200×1600 → 3:4. The placeholder bust shares it. */
export const BODY_ASPECT = 1200 / 1600;

/** Fraction of the box height the host occupies per preset (§8.1 item 3). */
export const LAYOUT_HEIGHT: Record<SceneLayout, number> = {
  center: 0.78,
  left: 0.7,
  desk: 0.62,
};

/** The desk strip's height as a fraction of the box (desk preset only). */
export const DESK_STRIP_FRACTION = 0.14;

/**
 * The rect the character layer is allotted: `center` = bottom-centre,
 * `left` = bottom-left, `desk` = bottom-centre sitting behind the desk strip
 * (the strip hides the lower half of that band). Width follows the body
 * aspect, capped at the box width.
 */
export function characterRect(layout: SceneLayout, box: Size, aspect = BODY_ASPECT): Rect {
  const h = Math.round(box.h * LAYOUT_HEIGHT[layout]);
  const w = Math.min(box.w, Math.round(h * aspect));
  const bottomInset = layout === 'desk' ? Math.round(box.h * DESK_STRIP_FRACTION * 0.5) : 0;
  const y = box.h - h - bottomInset;
  const x = layout === 'left' ? 0 : Math.round((box.w - w) / 2);
  return { x, y, w, h };
}

/** The desk strip rect (bottom band) — only meaningful for the `desk` preset. */
export function deskRect(box: Size): Rect {
  const h = Math.round(box.h * DESK_STRIP_FRACTION);
  return { x: 0, y: box.h - h, w: box.w, h };
}

/**
 * `contentFit: contain` — the sub-rect of `outer` an image of `aspect`
 * (w/h) really paints, bottom-aligned (the host stands on the floor of the
 * box, so spare vertical room goes above the head, spare horizontal room
 * splits evenly).
 */
export function containRect(outer: Rect, aspect: number): Rect {
  if (!(aspect > 0) || outer.w <= 0 || outer.h <= 0) return outer;
  const outerAspect = outer.w / outer.h;
  if (aspect >= outerAspect) {
    const h = outer.w / aspect;
    return { x: outer.x, y: outer.y + (outer.h - h), w: outer.w, h };
  }
  const w = outer.h * aspect;
  return { x: outer.x + (outer.w - w) / 2, y: outer.y, w, h: outer.h };
}

export interface MouthAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
}

/** Fractions of the body image → the mouth's pixel rect inside the painted body rect. */
export function mouthRect(anchor: MouthAnchor, body: Rect): Rect {
  return {
    x: body.x + anchor.x * body.w,
    y: body.y + anchor.y * body.h,
    w: anchor.w * body.w,
    h: anchor.h * body.h,
  };
}

/** The inverse: a pixel rect over the painted body → anchor fractions (the picker's read-out). */
export function anchorFromRect(rect: Rect, body: Rect, rotate = 0): Required<MouthAnchor> {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: round((rect.x - body.x) / body.w),
    y: round((rect.y - body.y) / body.h),
    w: round(rect.w / body.w),
    h: round(rect.h / body.h),
    rotate: Math.round(rotate * 10) / 10,
  };
}

/** Clamp an anchor into the unit square (the picker can drag past the edges). */
export function clampAnchor(a: MouthAnchor): MouthAnchor {
  const w = Math.min(1, Math.max(0.01, a.w));
  const h = Math.min(1, Math.max(0.01, a.h));
  return {
    x: Math.min(1 - w, Math.max(0, a.x)),
    y: Math.min(1 - h, Math.max(0, a.y)),
    w,
    h,
    ...(a.rotate !== undefined ? { rotate: a.rotate } : {}),
  };
}

/** The standard mouth anchor of the placeholder busts (§8.3) in their 300×400 canvas. */
export const PLACEHOLDER_MOUTH_ANCHOR: Required<MouthAnchor> = {
  x: 0.41,
  y: 0.455,
  w: 0.18,
  h: 0.075,
  rotate: 0,
};

/** §12: a missing/unreadable layer draws the placeholder with this fallback. */
export const PLACEHOLDER_FALLBACK = { kind: 'man', hue: 220 } as const;
