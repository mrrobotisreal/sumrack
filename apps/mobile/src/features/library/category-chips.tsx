import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ChipItem } from '@/features/library/library-filter';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Single-select horizontal chip row (M14, T45 — LIBRARY_CATEGORIES §4.1):
 * the category shelf row (`md`, 44dp) and the genre sub-row (`sm`, 36dp)
 * inside «Истории». Plain `ScrollView` + `Pressable` — zero new
 * dependencies (§1.2). Chips are icon + label + optional count badge; the
 * selected chip is an accent wash + accent border + accent text, the rest
 * sit quietly on the surface. On mount the selected chip scrolls into view
 * (a persisted «Путешествия» must not start off-screen).
 */
export function ChipRow<T extends string>({
  items,
  selected,
  onSelect,
  size = 'md',
  testID,
}: {
  items: readonly ChipItem<T>[];
  selected: T;
  onSelect: (key: T) => void;
  size?: 'md' | 'sm';
  testID?: string;
}) {
  const { tokens } = useAppTheme();
  const scrollRef = React.useRef<ScrollView>(null);
  const viewportWidth = React.useRef(0);
  const selectedLayout = React.useRef<{ x: number; width: number } | null>(null);
  const scrolledOnMount = React.useRef(false);

  // Runs once both measurements exist (chip and viewport onLayout order is
  // not guaranteed). Skips the scroll when the chip already fits at x=0.
  const scrollSelectedIntoView = React.useCallback(() => {
    const layout = selectedLayout.current;
    if (scrolledOnMount.current || !layout || viewportWidth.current === 0) return;
    scrolledOnMount.current = true;
    if (layout.x + layout.width <= viewportWidth.current) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, layout.x - 16), animated: false });
  }, []);

  const onChipLayout = React.useCallback(
    (key: T, e: LayoutChangeEvent) => {
      if (key !== selected) return;
      const { x, width } = e.nativeEvent.layout;
      selectedLayout.current = { x, width };
      scrollSelectedIntoView();
    },
    [selected, scrollSelectedIntoView],
  );

  const iconSize = size === 'md' ? 16 : 14;
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4"
      onLayout={(e) => {
        viewportWidth.current = e.nativeEvent.layout.width;
        scrollSelectedIntoView();
      }}
      testID={testID}
    >
      {items.map((item) => {
        const isSelected = item.key === selected;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            onLayout={(e) => onChipLayout(item.key, e)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={
              item.count === undefined ? item.label : `${item.label}, ${item.count}`
            }
            testID={testID ? `${testID}-${item.key}` : undefined}
            className={cn(
              'flex-row items-center justify-center rounded-full border',
              size === 'md' ? 'min-h-[44px] gap-2 px-4' : 'min-h-[36px] gap-1.5 px-3',
              isSelected ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
            )}
          >
            {item.icon && (
              <Ionicons
                name={item.icon}
                size={iconSize}
                color={isSelected ? tokens.accent : tokens.textMuted}
              />
            )}
            <Text
              className={cn(
                'font-ui-medium',
                size === 'md' ? 'text-base' : 'text-sm',
                isSelected ? 'text-accent' : 'text-text-muted',
              )}
            >
              {item.label}
            </Text>
            {item.count !== undefined && (
              <View className="rounded-full bg-surface-2 px-1.5">
                <Text variant="caption" className={cn('text-xs', isSelected && 'text-accent')}>
                  {item.count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
