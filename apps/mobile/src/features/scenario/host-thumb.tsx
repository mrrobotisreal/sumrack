import * as React from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import type { ScenarioRung } from '@/db/repositories/scenarios';

import { ScenarioScene, sceneSpecFrom, type SceneSpec } from './scene';

/**
 * The hub card's host portrait (T62 §9.1): T61's scene in `thumbnail` mode
 * (no lids/mouth, no vignette) inside a small rounded box — the placeholder
 * bust until the pack's PNG is staged, then the real art.
 */
export function rungSceneSpec(rung: ScenarioRung): SceneSpec {
  return sceneSpecFrom(rung.cast, rung.scene, rung.assets);
}

export function HostThumb({ spec, size = 64 }: { spec: SceneSpec; size?: number }) {
  const shape = useSharedValue(0);
  return (
    <View
      className="overflow-hidden rounded-xl border border-border bg-surface-2"
      style={{ width: size, height: size }}
    >
      <ScenarioScene spec={spec} pose="idle" shape={shape} active={false} thumbnail />
    </View>
  );
}
