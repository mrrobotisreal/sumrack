import * as React from 'react';
import {
  Text as RNText,
  Vibration,
  View,
  type LayoutChangeEvent,
  type TextStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { TokenRow } from '@/db/repositories/content';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  buildChunks,
  normalizeRange,
  snapRangeToWords,
  type ChunkRange,
  type TokenChunk,
} from './token-chunks';

/** How long a press must hold before the drag-selection pan takes over. */
const LONG_PRESS_MS = 320;

export interface PhraseSelection {
  chunks: TokenChunk[];
  range: ChunkRange;
}

interface TokenTextProps {
  tokens: TokenRow[];
  readingStyle: TextStyle;
  /** Tap on a word chunk (or a drag that ended on a single word). */
  onWordPress: (token: TokenRow) => void;
  /** Long-press-drag finished across ≥2 word chunks. */
  onPhraseSelected: (selection: PhraseSelection) => void;
  /** Fires when a drag selection starts/ends — reader locks list scroll. */
  onSelectingChange: (selecting: boolean) => void;
  /**
   * Karaoke (T10): tokenIndex of the word to highlight as currently spoken
   * (null/undefined = none). The chunk containing that token gets the
   * `karaoke` treatment: accent-soft wash, full text color (UI_DESIGN §1).
   */
  karaokeTokenIndex?: number | null;
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
 * TokenText (UI_DESIGN §7 — "the hardest component in the app"): renders a
 * sentence's tokens as unbreakable visual-word chunks in a wrapping row,
 * with tap-to-lookup on word chunks and long-press-drag phrase selection.
 *
 * Approach (T05 decision, recorded in the ticket log): chunks are separate
 * Text nodes in a flex-wrap View with columnGap as the inter-word space;
 * each chunk reports its frame via onLayout, and a Pan gesture with
 * activateAfterLongPress hit-tests those frames to grow a contiguous
 * selection range. Taps use plain Text onPress — when the pan activates,
 * gesture-handler cancels the native responder so presses can't double-fire.
 *
 * The gesture object is created once and dispatches through a latest-value
 * ref (same pattern as the reader's viewability handler) so its callbacks
 * stay stable while chunk data and selection logic update per render.
 */
export function TokenText({
  tokens,
  readingStyle,
  onWordPress,
  onPhraseSelected,
  onSelectingChange,
  karaokeTokenIndex,
}: TokenTextProps) {
  const { tokens: theme } = useAppTheme();
  const chunks = React.useMemo(() => buildChunks(tokens), [tokens]);

  const framesRef = React.useRef<Map<number, ChunkFrame>>(new Map());
  const anchorRef = React.useRef<number | null>(null);
  const rangeRef = React.useRef<ChunkRange | null>(null);
  const [range, setRangeState] = React.useState<ChunkRange | null>(null);

  const fontSize = typeof readingStyle.fontSize === 'number' ? readingStyle.fontSize : 19;
  /** Inter-chunk gap standing in for the space character (~0.26em in both faces). */
  const spaceWidth = Math.round(fontSize * 0.26);

  const onChunkLayout = React.useCallback((index: number, e: LayoutChangeEvent) => {
    framesRef.current.set(index, e.nativeEvent.layout);
  }, []);

  /**
   * Chunk under a point, with row tolerance: prefer exact hit, else the
   * horizontally-nearest chunk on the same visual row (so dragging through
   * the gaps between words never drops the selection).
   */
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

  // Latest-value handler ref: the once-created gesture dispatches through
  // this, so selection logic can close over fresh props/chunks safely.
  const handlersRef = React.useRef<PanHandlers>({
    onStart: () => {},
    onUpdate: () => {},
    onEnd: () => {},
    onCancel: () => {},
  });
  React.useEffect(() => {
    const setRange = (next: ChunkRange | null) => {
      rangeRef.current = next;
      setRangeState(next);
    };
    const finishSelection = () => {
      const final = rangeRef.current;
      anchorRef.current = null;
      setRange(null);
      onSelectingChange(false);
      if (!final) return;
      const snapped = snapRangeToWords(chunks, final);
      if (!snapped) return;
      if (snapped.start === snapped.end) {
        // A drag that never left one word — treat as a lookup, not a phrase.
        const word = chunks[snapped.start]?.wordToken;
        if (word) onWordPress(word);
        return;
      }
      onPhraseSelected({ chunks, range: snapped });
    };
    handlersRef.current = {
      onStart: (x, y) => {
        const hit = chunkAt(x, y);
        if (hit == null) return;
        anchorRef.current = hit;
        setRange({ start: hit, end: hit });
        onSelectingChange(true);
        Vibration.vibrate(8);
      },
      onUpdate: (x, y) => {
        const anchor = anchorRef.current;
        if (anchor == null) return;
        const hit = chunkAt(x, y);
        if (hit == null) return;
        const next = normalizeRange(anchor, hit);
        const cur = rangeRef.current;
        if (!cur || cur.start !== next.start || cur.end !== next.end) setRange(next);
      },
      onEnd: finishSelection,
      onCancel: () => {
        if (anchorRef.current != null) finishSelection();
        else onSelectingChange(false);
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
          // Karaoke lights the whole visual chunk its token lives in, so
          // attached punctuation glows with its word instead of splitting it.
          const karaoke =
            karaokeTokenIndex != null &&
            chunk.tokens.some((t) => t.tokenIndex === karaokeTokenIndex);
          const tappable = chunk.wordToken != null;
          return (
            <RNText
              key={chunk.index}
              onLayout={(e) => onChunkLayout(chunk.index, e)}
              onPress={tappable ? () => onWordPress(chunk.wordToken!) : undefined}
              suppressHighlighting
              className={selected || karaoke ? 'rounded-[3px] bg-accent-soft' : undefined}
              style={[readingStyle, { color: theme.text }]}
            >
              {chunk.text}
            </RNText>
          );
        })}
      </View>
    </GestureDetector>
  );
}
