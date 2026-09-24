import * as React from 'react';
import { ScrollView, Text as RNText, View, type TextStyle } from 'react-native';

import { SelectableText, type FreeSelection } from '@/components/selectable-text';
import { chunkRuns } from '@/lib/free-text';
import { parseMarkdown, type InlineRun, type MarkdownBlock } from '@/lib/markdown';
import { useAppTheme } from '@/theme/use-app-theme';

interface MarkdownViewProps {
  source: string;
  /** When provided, every text block hosts the highlight-to-bank gesture (T15 §7.4). */
  onSelection?: (selection: FreeSelection) => void;
  onSelectingChange?: (selecting: boolean) => void;
}

const READING: TextStyle = { fontFamily: 'Literata_400Regular', fontSize: 17, lineHeight: 27 };
/**
 * Tables wider than this many columns scroll horizontally with fixed column
 * widths instead of squeezing every cell to `flex-1` — a stress-marked form
 * must never break mid-word (T54 lesson tables are 4–5 columns; the T22
 * "never squished cells" convention, like the Forms tab's adjective grid).
 */
export const TABLE_FLEX_MAX_COLS = 3;
const TABLE_FIXED_COL_WIDTH = 150;

/** Exported for the unit test: does a table with `cols` columns scroll horizontally? */
export function tableScrollsHorizontally(cols: number): boolean {
  return cols > TABLE_FLEX_MAX_COLS;
}
const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 24, 2: 20, 3: 17 };

/**
 * Markdown preview for notes (T15) and, later, T17's grammar lessons.
 * Renders the small block model from `lib/markdown`; when `onSelection` is
 * set, paragraphs/list items/quotes/headings become SelectableText so the
 * reader's highlight gesture works on styled note text.
 */
export function MarkdownView({ source, onSelection, onSelectingChange }: MarkdownViewProps) {
  const { tokens: theme } = useAppTheme();
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);

  const renderRuns = (runs: InlineRun[], style: TextStyle) => {
    if (onSelection) {
      return (
        <SelectableText
          chunks={chunkRuns(runs)}
          textStyle={style}
          onSelection={onSelection}
          onSelectingChange={onSelectingChange}
        />
      );
    }
    return (
      <RNText style={[style, { color: theme.text }]}>
        {runs.map((run, i) => (
          <RNText
            key={i}
            style={[style, { color: theme.text }, runStyle(run, style, theme.accent)]}
          >
            {run.text}
          </RNText>
        ))}
      </RNText>
    );
  };

  return (
    <View className="gap-3">
      {blocks.map((block, i) => (
        <React.Fragment key={i}>{renderBlock(block, renderRuns, theme.textMuted)}</React.Fragment>
      ))}
    </View>
  );
}

function runStyle(run: InlineRun, base: TextStyle, accent: string): TextStyle {
  if (run.code) {
    const size = typeof base.fontSize === 'number' ? base.fontSize - 2 : 15;
    return { fontFamily: 'monospace', fontSize: size, color: accent };
  }
  if (run.bold) return { fontFamily: 'Literata_700Bold' };
  if (run.italic) return { fontFamily: 'Literata_400Regular_Italic' };
  return {};
}

function renderBlock(
  block: MarkdownBlock,
  renderRuns: (runs: InlineRun[], style: TextStyle) => React.ReactNode,
  mutedColor: string,
) {
  switch (block.kind) {
    case 'heading': {
      const size = HEADING_SIZES[block.level];
      return renderRuns(block.runs, {
        fontFamily: 'GolosText_700Bold',
        fontSize: size,
        lineHeight: Math.round(size * 1.35),
      });
    }
    case 'paragraph':
      return renderRuns(block.runs, READING);
    case 'list-item':
      return (
        <View className="flex-row gap-2 pl-1">
          <RNText style={[READING, { color: mutedColor }]}>{block.marker}</RNText>
          <View className="flex-1">{renderRuns(block.runs, READING)}</View>
        </View>
      );
    case 'quote':
      return (
        <View className="border-l-2 border-accent/40 pl-3">
          {renderRuns(block.runs, { ...READING, fontFamily: 'Literata_400Regular_Italic' })}
        </View>
      );
    case 'table': {
      const cols = Math.max(0, ...block.rows.map((cells) => cells.length));
      const scrolls = tableScrollsHorizontally(cols);
      const table = (
        <View
          className="overflow-hidden rounded-lg border border-border"
          style={scrolls ? { width: cols * TABLE_FIXED_COL_WIDTH } : undefined}
        >
          {block.rows.map((cells, r) => (
            <View
              key={r}
              className={`flex-row ${r > 0 ? 'border-t border-border' : ''} ${
                r === 0 && block.headerRow ? 'bg-surface-2' : ''
              }`}
            >
              {cells.map((runs, c) => (
                <View
                  key={c}
                  className={scrolls ? 'px-2.5 py-2' : 'flex-1 px-2.5 py-2'}
                  style={scrolls ? { width: TABLE_FIXED_COL_WIDTH } : undefined}
                >
                  {renderRuns(
                    runs,
                    r === 0 && block.headerRow
                      ? { fontFamily: 'GolosText_500Medium', fontSize: 14, lineHeight: 20 }
                      : { fontFamily: 'Literata_400Regular', fontSize: 15, lineHeight: 22 },
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      );
      if (!scrolls) return table;
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator bounces={false}>
          {table}
        </ScrollView>
      );
    }
    case 'code':
      return (
        <View className="rounded-lg bg-surface-2 px-3 py-2">
          <RNText
            style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 19, color: mutedColor }}
          >
            {block.text}
          </RNText>
        </View>
      );
    case 'hr':
      return <View className="my-1 h-px bg-border" />;
  }
}
