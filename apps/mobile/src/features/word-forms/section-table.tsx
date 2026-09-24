import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { gridScrollsHorizontally, sectionTitle, tagStyle } from './format';
import type { ProfileCell, ProfileRow, ProfileSection } from './profile-schema';

/**
 * One collapsible section card of the Forms tab (WORD_FORMS §7.2): title
 * (en + ru caption), the grid or list renderer, the section note, and the
 * footer with **Learn** (rendered but disabled until T54 wires it — never
 * hidden) and «Lessons · N» when N > 0.
 */
export function SectionCard({
  section,
  expanded,
  onToggle,
  lessonCount,
}: {
  section: ProfileSection;
  expanded: boolean;
  onToggle: () => void;
  /** Lessons stored for this section (T54 writes them; 0 until then). */
  lessonCount: number;
}) {
  const { tokens: theme } = useAppTheme();
  const title = sectionTitle(section);
  return (
    <View className="overflow-hidden rounded-xl border border-border bg-surface">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title.en} section`}
        className="flex-row items-center gap-3 px-4 py-3 active:bg-surface-2"
      >
        <View className="flex-1">
          <Text className="font-ui-medium">{title.en}</Text>
          <Text variant="caption" className="text-xs">
            {title.ru}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.textMuted}
        />
      </Pressable>

      {expanded && (
        <View className="border-t border-border">
          {section.layout === 'grid' && section.grid ? (
            <GridTable grid={section.grid} />
          ) : (
            <ListTable rows={section.rows ?? []} />
          )}

          {section.note && (
            <Text variant="caption" className="px-4 pb-3 pt-2 text-xs">
              {section.note}
            </Text>
          )}

          {/* footer: Learn (disabled here — T54 flips the wiring) + lesson count */}
          <View className="flex-row items-center justify-between border-t border-border px-4 py-2.5">
            <View>
              <Pressable
                disabled
                accessibilityRole="button"
                accessibilityLabel={`Learn ${title.en}`}
                accessibilityState={{ disabled: true }}
                className="flex-row items-center gap-1.5 opacity-40"
              >
                <Ionicons name="sparkles-outline" size={15} color={theme.accent} />
                <Text className="font-ui-medium text-sm text-accent">Learn</Text>
              </Pressable>
              <Text variant="caption" className="text-xs">
                Lessons arrive with T54
              </Text>
            </View>
            {lessonCount > 0 && <Text variant="caption">Lessons · {lessonCount}</Text>}
          </View>
        </View>
      )}
    </View>
  );
}

// --- grid ---------------------------------------------------------------------

const LABEL_COL_WIDTH = 124;
const VALUE_COL_WIDTH = 150;

/**
 * Grid renderer: header = colLabels, first column = rowLabels, cells `ru`
 * in Literata + gloss caption, null → «—», a cell `note` → ⓘ that toggles
 * the note under its row. Wide grids (> 2 value columns — adjectives)
 * scroll horizontally inside the card with fixed column widths; 1–2 column
 * grids stretch to the card width (never squished cells — T22 convention).
 */
function GridTable({ grid }: { grid: NonNullable<ProfileSection['grid']> }) {
  const scrolls = gridScrollsHorizontally(grid.colLabels);
  const [openNotes, setOpenNotes] = React.useState<ReadonlySet<number>>(() => new Set());
  const toggleNote = React.useCallback((r: number) => {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }, []);

  const valueStyle = scrolls ? { width: VALUE_COL_WIDTH } : undefined;
  const table = (
    <View style={scrolls ? undefined : { alignSelf: 'stretch' }}>
      {/* header */}
      <View className="flex-row border-b border-border bg-surface-2/60">
        <View style={{ width: LABEL_COL_WIDTH }} className="px-3 py-2" />
        {grid.colLabels.map((label, c) => (
          <View key={c} style={valueStyle} className={cn('px-3 py-2', !scrolls && 'flex-1')}>
            <Text variant="caption" className="font-ui-medium text-xs">
              {label}
            </Text>
          </View>
        ))}
      </View>

      {grid.rowLabels.map((rowLabel, r) => {
        const cells = grid.cells[r] ?? [];
        const rowNotes = cells
          .map((cell, c) => (cell?.note ? { col: grid.colLabels[c] ?? '', note: cell.note } : null))
          .filter((n): n is { col: string; note: string } => n !== null);
        const noteOpen = openNotes.has(r);
        return (
          <View key={r} className={cn(r > 0 && 'border-t border-border')}>
            <View className="flex-row">
              <View style={{ width: LABEL_COL_WIDTH }} className="justify-center px-3 py-2">
                <Text variant="caption" className="text-xs">
                  {rowLabel}
                </Text>
              </View>
              {cells.map((cell, c) => (
                <View
                  key={c}
                  style={valueStyle}
                  className={cn('justify-center px-3 py-2', !scrolls && 'flex-1')}
                >
                  <GridCell cell={cell} hasNote={!!cell?.note} onNote={() => toggleNote(r)} />
                </View>
              ))}
            </View>
            {noteOpen && rowNotes.length > 0 && (
              <View className="gap-0.5 bg-surface-2/60 px-3 py-1.5">
                {rowNotes.map((n, i) => (
                  <Text key={i} variant="caption" className="text-xs">
                    {grid.colLabels.length > 1 ? `${n.col}: ` : ''}
                    {n.note}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  if (!scrolls) return table;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator bounces={false}>
      {table}
    </ScrollView>
  );
}

function GridCell({
  cell,
  hasNote,
  onNote,
}: {
  cell: ProfileCell | undefined;
  hasNote: boolean;
  onNote: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  if (!cell) {
    return (
      <Text variant="caption" accessibilityLabel="no form">
        —
      </Text>
    );
  }
  return (
    <View>
      <View className="flex-row items-start gap-1">
        {/* one Text run per form: the vowel and its combining acute never split */}
        <RNText
          className="flex-shrink font-reading text-base leading-6 text-text"
          accessibilityLabel={cell.plain}
        >
          {cell.ru}
        </RNText>
        {hasNote && (
          <Pressable
            onPress={onNote}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show note"
            className="mt-1"
          >
            <Ionicons name="information-circle-outline" size={14} color={theme.textMuted} />
          </Pressable>
        )}
      </View>
      {cell.gloss && (
        <Text variant="caption" className="text-xs">
          {cell.gloss}
        </Text>
      )}
    </View>
  );
}

// --- list ---------------------------------------------------------------------

/** List renderer: `ru` + gloss, tag pills, muted note, italic example + English caption. */
function ListTable({ rows }: { rows: ProfileRow[] }) {
  return (
    <View>
      {rows.map((row, i) => (
        <View key={i} className={cn('px-4 py-2.5', i > 0 && 'border-t border-border')}>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <RNText
              className="font-reading text-base leading-6 text-text"
              accessibilityLabel={row.plain}
            >
              {row.ru}
            </RNText>
            {row.tags?.map((tag) => (
              <TagPill key={tag} tag={tag} />
            ))}
          </View>
          <Text variant="caption" className="mt-0.5">
            {row.gloss}
          </Text>
          {row.note && (
            <Text variant="caption" className="mt-0.5 text-xs">
              {row.note}
            </Text>
          )}
          {row.example && (
            <View className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2">
              <RNText className="font-reading-italic text-base leading-6 text-text">
                {row.example.ru}
              </RNText>
              <Text variant="caption" className="mt-0.5 text-xs">
                {row.example.en}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function TagPill({ tag }: { tag: string }) {
  const style = tagStyle(tag);
  return (
    <View className={cn('rounded-full px-1.5 py-px', style.bg)}>
      <Text className={cn('font-ui-medium text-xs', style.text)}>{style.label}</Text>
    </View>
  );
}
