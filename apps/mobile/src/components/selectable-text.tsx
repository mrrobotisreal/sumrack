import * as React from 'react';
import {
  Text as RNText,
  Vibration,
  View,
  type LayoutChangeEvent,
  type TextStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import {
  cleanSurface,
  normalizeFreeRange,
  phraseSurface,
  snapFreeRangeToWords,
  wordCountInRange,
  type FreeChunk,
  type FreeRange,
} from '@/lib/free-text';
import { useAppTheme } from '@/theme/use-app-theme';

/** Same long-press threshold as the reader's TokenText (T05). */
const LONG_PRESS_MS = 320;

export interface FreeSelection {
  /** Clean surface form (edge punctuation stripped). */
  surface: string;
  /** Word chunks inside the selection — 1 = single word, ≥2 = phrase. */
  wordCount: number;
  chunks: FreeChunk[];
  range: FreeRange;
}

interface SelectableTextProps {
  chunks: FreeChunk[];
  /** Base text style (font family/size/line height); segments add bold/italic/code. */
  textStyle: TextStyle;
  /** Tap on a word, or a drag that stayed on one word. */
  onSelection: (selection: FreeSelection) => void;
  /** Drag selection active — parents lock their scroll view. */
  onSelectingChange?: (selecting: boolean) => void;
}

interface ChunkFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanHandlers {
  onStart: (x: number, y: number) => void;
  onUpdate: (x: number, y: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

/**
 * SelectableText (T15): the reader's tap/long-press-drag selection for free
 * text with no `tokens` rows behind it — journal entries and notes preview
 * (design §7.4). Same mechanics as TokenText (T05): chunks laid out in a
 * wrapping row with columnGap as the space, frames recorded onLayout, one
 * long-press Pan gesture hit-testing frames with same-row snapping. Kept
 * separate from TokenText because the chunk model differs (styled segments,
 * no token annotations) — the gesture pattern is shared by convention.
 */
export function SelectableText({
  chunks,
  textStyle,
  onSelection,
  onSelectingChange,
}: SelectableTextProps) {
  const { tokens: theme } = useAppTheme();

  const framesRef = React.useRef<Map<number, ChunkFrame>>(new Map());
  const anchorRef = React.useRef<number | null>(null);
  const rangeRef = React.useRef<FreeRange | null>(null);
  const [range, setRangeState] = React.useState<FreeRange | null>(null);

  const fontSize = typeof textStyle.fontSize === 'number' ? textStyle.fontSize : 19;
  const spaceWidth = Math.round(fontSize * 0.26);

  const onChunkLayout = React.useCallback((index: number, e: LayoutChangeEvent) => {
    framesRef.current.set(index, e.nativeEvent.layout);
  }, []);

  /** Chunk under a point, with same-row horizontal snapping (T05 pattern). */
  const chunkAt = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const [index, f] of framesRef.current) {
      if (y < f.y || y > f.y + f.height) continue;
      if (x >= f.x && x <= f.x + f.width) return index;
      const dist = x < f.x ? f.x - x : x - (f.x + f.width);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    }
    return best;
  };

  const emitSelection = React.useCallback(
    (snapped: FreeRange) => {
      const wordCount = wordCountInRange(chunks, snapped);
      const surface =
        wordCount === 1
          ? cleanSurface(
              chunks
                .slice(snapped.start, snapped.end + 1)
                .filter((c) => c.isWord)
                .map((c) => c.text)
                .join(' '),
            )
          : phraseSurface(chunks, snapped);
      if (!surface) return;
      onSelection({ surface, wordCount, chunks, range: snapped });
    },
    [chunks, onSelection],
  );

  // Latest-value handler ref so the once-created gesture stays stable
  // while chunk data changes (same pattern as TokenText / T04 viewability).
  const handlersRef = React.useRef<PanHandlers>({
    onStart: () => {},
    onUpdate: () => {},
    onEnd: () => {},
    onCancel: () => {},
  });
  React.useEffect(() => {
    const setRange = (next: FreeRange | null) => {
      rangeRef.current = next;
      setRangeState(next);
    };
    const finishSelection = () => {
      const final = rangeRef.current;
      anchorRef.current = null;
      setRange(null);
      onSelectingChange?.(false);
      if (!final) return;
      const snapped = snapFreeRangeToWords(chunks, final);
      if (!snapped) return;
      emitSelection(snapped);
    };
    handlersRef.current = {
      onStart: (x, y) => {
        const hit = chunkAt(x, y);
        if (hit == null) return;
        anchorRef.current = hit;
        setRange({ start: hit, end: hit });
        onSelectingChange?.(true);
        Vibration.vibrate(8);
      },
      onUpdate: (x, y) => {
        const anchor = anchorRef.current;
        if (anchor == null) return;
        const hit = chunkAt(x, y);
        if (hit == null) return;
        const next = normalizeFreeRange(anchor, hit);
        const cur = rangeRef.current;
        if (!cur || cur.start !== next.start || cur.end !== next.end) setRange(next);
      },
      onEnd: finishSelection,
      onCancel: () => {
        if (anchorRef.current != null) finishSelection();
        else onSelectingChange?.(false);
      },
    };
  });

  // False positive: Gesture's .onX() methods *register* event handlers —
  // the closures (and thus the ref) only run on touch events, never render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = React.useState(() =>
    Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .runOnJS(true)
      .onStart((e) => handlersRef.current.onStart(e.x, e.y))
      .onUpdate((e) => handlersRef.current.onUpdate(e.x, e.y))
      .onEnd(() => handlersRef.current.onEnd())
      .onFinalize((_e, success) => {
        if (!success) handlersRef.current.onCancel();
      }),
  );

  const segmentStyle = (seg: FreeChunk['segments'][number]): TextStyle => {
    if (seg.code) {
      return { fontFamily: 'monospace', fontSize: fontSize - 2, color: theme.accent };
    }
    if (seg.bold && textStyle.fontFamily === 'Literata_400Regular') {
      return { fontFamily: 'Literata_700Bold' };
    }
    if (seg.bold) return { fontFamily: 'GolosText_700Bold' };
    if (seg.italic && textStyle.fontFamily === 'Literata_400Regular') {
      return { fontFamily: 'Literata_400Regular_Italic' };
    }
    if (seg.italic) return { fontStyle: 'italic' };
    return {};
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        className="flex-row flex-wrap"
        style={{ columnGap: spaceWidth }}
        accessible
        accessibilityLabel={chunks.map((c) => c.text).join(' ')}
      >
        {chunks.map((chunk) => {
          const selected = range != null && chunk.index >= range.start && chunk.index <= range.end;
          const tappable = chunk.isWord;
          return (
            <RNText
              key={chunk.index}
              onLayout={(e) => onChunkLayout(chunk.index, e)}
              onPress={
                tappable ? () => emitSelection({ start: chunk.index, end: chunk.index }) : undefined
              }
              suppressHighlighting
              className={selected ? 'rounded-[3px] bg-accent-soft' : undefined}
              style={[textStyle, { color: theme.text }]}
            >
              {chunk.segments.map((seg, i) => (
                <RNText key={i} style={[textStyle, { color: theme.text }, segmentStyle(seg)]}>
                  {seg.text}
                </RNText>
              ))}
            </RNText>
          );
        })}
      </View>
    </GestureDetector>
  );
}
