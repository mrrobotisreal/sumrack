import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import type { CoreCoverage } from '@/db/repositories/dashboard';
import { useAppTheme } from '@/theme/use-app-theme';

import { LegendItem, mixHex, SegmentedBar, useMasteryRamp } from './charts';
import type { Forecast } from './science/forecast';
import type { HeatLevel, HeatmapLayout } from './science/heatmap';
import { EmptyHint, SectionCard } from './section-card';

/**
 * T38 dashboard sections (V2 §7.7): core coverage, the 30-day due forecast
 * and the year heatmap. Thin consumers of the pure modules in ./science —
 * View-based marks, colors derived from theme tokens (T18 chart stance).
 */

const tabular = { fontVariant: ['tabular-nums' as const] };

// --- Core coverage -----------------------------------------------------------------

/**
 * Per level: one stacked meter over the core-list total — mastered (accent)
 * / collected-not-mastered (young step) / encountered-only (shaky step) /
 * not met yet (track). Each band carries a labeled count — never color alone.
 */
export function CoreCoverageSection({
  data,
  onOpenGaps,
}: {
  data: CoreCoverage[];
  onOpenGaps: (level: CoreCoverage['level']) => void;
}) {
  const ramp = useMasteryRamp();
  const { tokens } = useAppTheme();
  const met = mixHex(tokens.accent, tokens.surface, 0.3);

  if (data.length === 0) {
    return (
      <SectionCard title="Core vocabulary">
        <EmptyHint>
          No core list installed yet — sync content to get the A1/A2 core vocabulary reference.
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Core vocabulary">
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <LegendItem color={ramp.mature} label="mastered" />
        <LegendItem color={ramp.young} label="collected" />
        <LegendItem color={met} label="met in a story" />
      </View>
      <View className="mt-4 gap-5">
        {data.map((d) => {
          const gaps = d.total - d.encountered;
          return (
            <View key={d.level} className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <LevelChip level={d.level} />
                <Text variant="caption" style={tabular}>
                  {d.encountered} of {d.total} met ·{' '}
                  {Math.round((100 * d.encountered) / Math.max(1, d.total))}%
                </Text>
              </View>
              <SegmentedBar
                segments={[
                  { value: d.mastered, color: ramp.mature },
                  { value: d.collected - d.mastered, color: ramp.young },
                  { value: d.encountered - d.collected, color: met },
                ]}
                total={d.total}
                trackColor={ramp.track}
              />
              <View className="flex-row items-center justify-between">
                <Text variant="caption" style={tabular}>
                  {d.mastered} mastered · {d.collected} collected
                </Text>
                {gaps > 0 && (
                  <Pressable
                    onPress={() => onOpenGaps(d.level)}
                    accessibilityRole="button"
                    accessibilityLabel={`${gaps} core ${d.level} words not met yet`}
                    hitSlop={8}
                    className="flex-row items-center gap-1 active:opacity-60"
                  >
                    <Text variant="caption" className="text-accent" style={tabular}>
                      {gaps} not met yet
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={tokens.accent} />
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </SectionCard>
  );
}

// --- Due forecast --------------------------------------------------------------------

const RU_WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DIRECTION_LABEL: Record<string, string> = {
  'ru-en': 'RU→EN',
  'en-ru': 'EN→RU',
  listening: 'listening',
  production: 'speaking',
};

function dayLabel(date: string, offset: number): string {
  if (offset === 0) return 'Сегодня';
  if (offset === 1) return 'Завтра';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return `${RU_WEEKDAY[dt.getDay()]} ${d}.${String(m).padStart(2, '0')}`;
}

/**
 * 30 thin columns (day 0 = today incl. the overdue backlog, emphasized),
 * tap a column → the detail line under the chart. Recessive baseline,
 * selective x labels (today, +7, +14, +21, +29).
 */
export function ForecastSection({
  forecast,
  onSelectDay,
}: {
  forecast: Forecast;
  onSelectDay?: (offset: number) => void;
}) {
  const { tokens } = useAppTheme();
  const [selected, setSelected] = React.useState(0);
  const height = 72;
  const peak = Math.max(1, forecast.peak);
  const rest = mixHex(tokens.accent, tokens.surface, 0.55);
  const day = forecast.days[selected];
  const total30 = forecast.days.reduce((n, d) => n + d.total, 0);
  const today = forecast.days[0]?.total ?? 0;

  if (total30 + forecast.later === 0) {
    return (
      <SectionCard title="Coming up · 30 days">
        <EmptyHint>No cards yet — collect words and their reviews show up here.</EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Coming up · 30 days">
      <Text className="font-ui-medium">
        {today} due today
        {forecast.overdue > 0 ? ` (${forecast.overdue} overdue)` : ''} · {total30} in 30 days
      </Text>
      <Text variant="caption" className="mt-0.5">
        если не заниматься — what falls due if you do no reviews at all
      </Text>
      <View
        className="mt-3 flex-row items-end"
        style={{ height, columnGap: 2, borderBottomWidth: 1, borderBottomColor: tokens.border }}
      >
        {forecast.days.map((d) => {
          const h = d.total > 0 ? Math.max(3, (d.total / peak) * height) : 0;
          const isSel = d.offset === selected;
          return (
            <Pressable
              key={d.date}
              className="h-full flex-1 justify-end"
              onPress={() => {
                setSelected(d.offset);
                onSelectDay?.(d.offset);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(d.date, d.offset)}: ${d.total} due`}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <View
                style={{
                  height: h,
                  backgroundColor: d.offset === 0 || isSel ? tokens.accent : rest,
                  borderTopLeftRadius: 3,
                  borderTopRightRadius: 3,
                  opacity: isSel || selected === 0 || d.offset === 0 ? 1 : 0.85,
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1 flex-row">
        {forecast.days.map((d) => (
          <View key={d.date} className="flex-1 items-center" style={{ overflow: 'visible' }}>
            {[0, 7, 14, 21, 29].includes(d.offset) ? (
              <Text variant="caption" style={{ fontSize: 9, width: 40, textAlign: 'center' }}>
                {d.offset === 0 ? 'сег' : `+${d.offset}`}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {day && (
        <View className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
          <Text className="text-sm" style={tabular}>
            {dayLabel(day.date, day.offset)} · {day.total} {day.total === 1 ? 'card' : 'cards'}
          </Text>
          {day.total > 0 && (
            <Text variant="caption" style={tabular}>
              {Object.entries(day.byDirection)
                .sort((a, b) => b[1] - a[1])
                .map(([dir, n]) => `${DIRECTION_LABEL[dir] ?? dir} ${n}`)
                .join(' · ')}
            </Text>
          )}
        </View>
      )}
      {forecast.later > 0 && (
        <Text variant="caption" className="mt-2" style={tabular}>
          +{forecast.later} due later than 30 days
        </Text>
      )}
    </SectionCard>
  );
}

// --- Year heatmap --------------------------------------------------------------------

/**
 * The sequential heatmap ramp, derived from the accent per theme and
 * validated with the dataviz ordinal check (one hue, monotone lightness,
 * light end ≥ 2:1 vs the surface) — recorded in the T38 notes:
 * dark  #833328 · #B3402F · #c06a5c · #ce9389 (on #141419, light → dark reads dim → bright)
 * light #cb9289 · #b56457 · #A03828 · #712e25 (on #FFFFFF)
 * Level 0 (no activity) is the near-neutral track, so "nothing" never
 * reads as "a little".
 */
export function useHeatRamp(): Record<HeatLevel, string> {
  const { tokens, scheme } = useAppTheme();
  return React.useMemo(() => {
    const empty = mixHex(tokens.text, tokens.surface, 0.08);
    if (scheme === 'dark') {
      return {
        0: empty,
        1: mixHex(tokens.accent, tokens.surface, 0.7),
        2: tokens.accent,
        3: mixHex(tokens.text, tokens.accent, 0.25),
        4: mixHex(tokens.text, tokens.accent, 0.5),
      };
    }
    return {
      0: empty,
      1: mixHex(tokens.accent, tokens.surface, 0.55),
      2: mixHex(tokens.accent, tokens.surface, 0.78),
      3: tokens.accent,
      4: mixHex(tokens.text, tokens.accent, 0.35),
    };
  }, [tokens, scheme]);
}

const CELL_GAP = 2;
const WEEKDAY_ROWS = ['пн', '', 'ср', '', 'пт', '', ''];

function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return `${RU_WEEKDAY[dt.getDay()]} ${d}.${String(m).padStart(2, '0')}.${y}`;
}

/**
 * GitHub-style year grid: 53 Monday-first week columns × 7 rows, cell size
 * computed from the measured width so the whole year fits the card at
 * phone width. Tap a cell → its date + XP under the grid.
 */
export function YearHeatmapSection({ layout }: { layout: HeatmapLayout }) {
  const ramp = useHeatRamp();
  const [width, setWidth] = React.useState(0);
  const [picked, setPicked] = React.useState<{ date: string; value: number } | null>(null);
  const labelW = 16;
  const cols = layout.weeks.length;
  const cell = width > 0 ? Math.max(3, Math.floor((width - labelW - CELL_GAP * cols) / cols)) : 0;

  return (
    <SectionCard title="Year of activity">
      <Text className="font-ui-medium" style={tabular}>
        {layout.activeDays} active {layout.activeDays === 1 ? 'day' : 'days'} · {layout.totalXp} XP
        this year
      </Text>
      <View className="mt-3" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {cell > 0 && (
          <>
            <View className="flex-row" style={{ marginLeft: labelW, height: 12 }}>
              {layout.monthLabels.map((m) => (
                <Text
                  key={`${m.col}-${m.label}`}
                  variant="caption"
                  style={{ position: 'absolute', left: m.col * (cell + CELL_GAP), fontSize: 9 }}
                >
                  {m.label}
                </Text>
              ))}
            </View>
            <View className="mt-1 flex-row">
              <View style={{ width: labelW, rowGap: CELL_GAP }}>
                {WEEKDAY_ROWS.map((l, i) => (
                  <Text
                    key={i}
                    variant="caption"
                    style={{ height: cell, fontSize: 8, lineHeight: cell }}
                  >
                    {l}
                  </Text>
                ))}
              </View>
              <View className="flex-row" style={{ columnGap: CELL_GAP }}>
                {layout.weeks.map((week, col) => (
                  <View key={col} style={{ rowGap: CELL_GAP }}>
                    {week.map((c) => (
                      <Pressable
                        key={c.date}
                        disabled={c.future}
                        onPress={() => setPicked({ date: c.date, value: c.value })}
                        accessibilityLabel={`${c.date}: ${c.value} XP`}
                        style={{
                          width: cell,
                          height: cell,
                          borderRadius: 2,
                          backgroundColor: c.future ? 'transparent' : ramp[c.level],
                        }}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </View>
      <View className="mt-2 flex-row items-center justify-between">
        <Text variant="caption" style={tabular}>
          {picked
            ? `${prettyDate(picked.date)} · ${picked.value} XP`
            : layout.max
              ? `Best day ${prettyDate(layout.max.date)} · ${layout.max.value} XP`
              : 'No activity yet'}
        </Text>
        <View className="flex-row items-center gap-1">
          <Text variant="caption" style={{ fontSize: 9 }}>
            0
          </Text>
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <View
              key={l}
              style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: ramp[l] }}
            />
          ))}
          <Text variant="caption" style={{ fontSize: 9 }}>
            100+
          </Text>
        </View>
      </View>
    </SectionCard>
  );
}
