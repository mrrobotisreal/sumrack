import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * View-based chart primitives for the dashboard (T18). No SVG dependency —
 * everything is flexbox bars/columns/dots, which covers the dataviz
 * conventions this app uses: thin marks, 2px surface gaps between fills,
 * rounded data-ends, recessive axes, selective direct labels.
 *
 * Color discipline: every chart color is DERIVED from theme tokens at
 * runtime (mixed toward the surface for sequential steps) — no hardcoded
 * hex values, both themes get deliberate ramps (dataviz: dark mode is
 * selected, not flipped — the mix runs against each theme's own surface).
 * The mastery ramp is sequential (one hue, monotonic lightness — verified
 * with the dataviz validator); band identity never rests on color alone:
 * each band ships a labeled count beside a color dot.
 */

/** Mix `fg` toward `bg` (both #RRGGBB) — poor man's alpha compositing. */
export function mixHex(fg: string, bg: string, t: number): string {
  const f = [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const mixed = f.map((c, i) => Math.round(c * t + b[i]! * (1 - t)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The sequential mastery ramp + structural colors, derived from tokens. */
export function useMasteryRamp() {
  const { tokens } = useAppTheme();
  return React.useMemo(
    () => ({
      /** Reviewed, stability ≥ 30 d — the "reliably know" step. */
      mature: tokens.accent,
      /** Reviewed, stability 7–30 d. */
      young: mixHex(tokens.accent, tokens.surface, 0.75),
      /** Reviewed, stability < 7 d — "shaky". */
      learning: mixHex(tokens.accent, tokens.surface, 0.45),
      /** Collected but never reviewed — deliberately near-neutral ("no signal"). */
      unreviewed: mixHex(tokens.text, tokens.surface, 0.14),
      /** Encountered-only remainder — the bar's track. */
      track: mixHex(tokens.text, tokens.surface, 0.05),
    }),
    [tokens],
  );
}

export interface BarSegment {
  value: number;
  color: string;
}

/**
 * Horizontal stacked bar: segments proportional to value over `total`,
 * 2px gaps, rounded ends. Zero-value segments render nothing (no phantom
 * gaps). `total` larger than the segment sum leaves track-colored rest.
 */
export function SegmentedBar({
  segments,
  total,
  trackColor,
  height = 10,
}: {
  segments: BarSegment[];
  total: number;
  trackColor: string;
  height?: number;
}) {
  const visible = segments.filter((s) => s.value > 0);
  const sum = visible.reduce((acc, s) => acc + s.value, 0);
  const denominator = Math.max(total, sum);
  return (
    <View
      className="w-full flex-row overflow-hidden rounded-full"
      style={{ height, columnGap: 2, backgroundColor: trackColor }}
    >
      {visible.map((s, i) => (
        <View
          key={i}
          className="rounded-full"
          style={{ flexGrow: s.value / denominator, flexBasis: 0, backgroundColor: s.color }}
        />
      ))}
      {denominator > sum && (
        <View style={{ flexGrow: (denominator - sum) / denominator, flexBasis: 0 }} />
      )}
    </View>
  );
}

/** Legend dot + label + count — the band identity carrier (never color alone). */
export function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value?: number;
}) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text variant="caption">
        {value != null ? `${value} ` : ''}
        {label}
      </Text>
    </View>
  );
}

export interface ColumnPoint {
  value: number;
  /** Optional short x label rendered under the column (selective — pass few). */
  label?: string;
  /** Column with no data at all (renders a baseline stub, not a zero bar). */
  missing?: boolean;
}

/**
 * Mini column chart (activity / pronunciation trends): bottom-aligned thin
 * columns, 2px gaps, rounded tops, hairline baseline. Height is fixed;
 * values scale to the max (or `max` when given, e.g. score charts pin 100).
 */
export function MiniColumns({
  points,
  max,
  color,
  height = 56,
}: {
  points: ColumnPoint[];
  max?: number;
  color: string;
  height?: number;
}) {
  const { tokens } = useAppTheme();
  const peak = Math.max(max ?? 0, ...points.map((p) => p.value), 1);
  return (
    <View>
      <View
        className="flex-row items-end"
        style={{ height, columnGap: 2, borderBottomWidth: 1, borderBottomColor: tokens.border }}
      >
        {points.map((p, i) => {
          const h = p.missing ? 0 : Math.max(p.value > 0 ? 3 : 0, (p.value / peak) * height);
          return (
            <View key={i} className="flex-1 items-stretch justify-end">
              <View
                style={{
                  height: h,
                  backgroundColor: color,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                }}
              />
            </View>
          );
        })}
      </View>
      <View className="mt-1 flex-row" style={{ columnGap: 2 }}>
        {points.map((p, i) => (
          <View key={i} className="flex-1 items-center">
            {p.label ? <Text variant="caption">{p.label}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export const CEFR_TRACK_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

export interface TrackPoint {
  /** 1-based CEFR ordinal (A1 = 1 … C1 = 5). */
  ord: number;
  /** Short label under the point (date). */
  label?: string;
  /** Highlight (the latest assessment). */
  emphasized?: boolean;
}

/**
 * Assessment-trend small multiple (one per skill): x = assessment index,
 * y = CEFR level on five faint gridlines, ≥8px dots. Small multiples
 * instead of a multi-series line keeps each row single-series — no
 * categorical palette needed at all.
 */
export function LevelDotTrack({ points, height = 64 }: { points: TrackPoint[]; height?: number }) {
  const { tokens } = useAppTheme();
  const rowH = height / CEFR_TRACK_LEVELS.length;
  return (
    <View className="flex-row">
      {/* y labels */}
      <View style={{ height }} className="mr-2 justify-between">
        {[...CEFR_TRACK_LEVELS].reverse().map((l) => (
          <Text key={l} variant="caption" style={{ fontSize: 9, lineHeight: rowH }}>
            {l}
          </Text>
        ))}
      </View>
      <View className="flex-1">
        <View style={{ height }}>
          {/* gridlines */}
          {CEFR_TRACK_LEVELS.map((_, i) => (
            <View
              key={i}
              className="absolute left-0 right-0"
              style={{
                top: (i + 0.5) * rowH - 0.5,
                height: 1,
                backgroundColor: tokens.border,
              }}
            />
          ))}
          {/* dots, evenly spaced */}
          <View className="h-full flex-row">
            {points.map((p, i) => (
              <View key={i} className="flex-1 items-center">
                <View
                  className="absolute rounded-full"
                  style={{
                    width: p.emphasized ? 10 : 8,
                    height: p.emphasized ? 10 : 8,
                    top: (CEFR_TRACK_LEVELS.length - p.ord + 0.5) * rowH - (p.emphasized ? 5 : 4),
                    backgroundColor: p.emphasized
                      ? tokens.accent
                      : mixHex(tokens.accent, tokens.surface, 0.6),
                  }}
                />
              </View>
            ))}
          </View>
        </View>
        <View className="mt-1 flex-row">
          {points.map((p, i) => (
            <View key={i} className="flex-1 items-center">
              {p.label ? (
                <Text variant="caption" style={{ fontSize: 9 }}>
                  {p.label}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
