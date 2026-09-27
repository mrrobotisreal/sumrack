import type { ScenarioCharacter, ScenarioScene } from '@sumrak/schema';

import type { ScenarioDetail } from '@/db/repositories/scenarios';

import type { MouthStyle } from './mouth';
import type { PlaceholderKind } from './placeholder-busts';
import { PLACEHOLDER_FALLBACK, type MouthAnchor, type SceneLayout } from './scene-geometry';

/**
 * Everything the renderer needs, resolved from a scenario's cast + scene +
 * staged assets (T58 `scenario_assets.localUri`) — pure, so the dev gallery
 * can override any field and T62 can build one for a hub thumbnail.
 */
export interface SceneSpec {
  accent: string | null;
  layout: SceneLayout;
  bed: string | null;
  backdropUri: string | null;
  bodyUri: string | null;
  eyelidsUri: string | null;
  mouthAnchor: MouthAnchor | null;
  mouthStyle: MouthStyle;
  placeholder: { kind: PlaceholderKind; hue: number } | null;
  /** The host's display name (accessibility label). */
  hostName: string | null;
}

export const EMPTY_SCENE_SPEC: SceneSpec = {
  accent: null,
  layout: 'center',
  bed: null,
  backdropUri: null,
  bodyUri: null,
  eyelidsUri: null,
  mouthAnchor: null,
  mouthStyle: 'default',
  placeholder: null,
  hostName: null,
};

/** The one drawn character: the `host`, else the first non-player. */
export function hostOf(cast: readonly ScenarioCharacter[]): ScenarioCharacter | null {
  return cast.find((c) => c.role === 'host') ?? cast.find((c) => c.role !== 'player') ?? null;
}

export function sceneSpecFrom(
  cast: readonly ScenarioCharacter[],
  scene: ScenarioScene | null,
  assets: readonly { file: string; localUri: string | null }[],
): SceneSpec {
  const host = hostOf(cast);
  const uriFor = (file: string | null | undefined): string | null => {
    if (!file) return null;
    return assets.find((a) => a.file === file)?.localUri ?? null;
  };
  const portrait = host?.portrait;
  return {
    accent: scene?.accent ?? null,
    layout: scene?.layout ?? 'center',
    bed: scene?.bed ?? null,
    backdropUri: uriFor(scene?.backdrop),
    bodyUri: uriFor(portrait?.body),
    eyelidsUri: uriFor(portrait?.eyelids),
    mouthAnchor: portrait?.mouthAnchor ?? null,
    mouthStyle: portrait?.mouthStyle ?? 'default',
    placeholder: portrait?.placeholder ?? null,
    hostName: host?.name.ru ?? null,
  };
}

export function sceneSpecFor(detail: ScenarioDetail): SceneSpec {
  return sceneSpecFrom(detail.cast, detail.scene, detail.assets);
}

/** §12: the placeholder to draw when there is no PNG (or it failed). */
export function placeholderOf(spec: SceneSpec): { kind: PlaceholderKind; hue: number } {
  return spec.placeholder ?? PLACEHOLDER_FALLBACK;
}
