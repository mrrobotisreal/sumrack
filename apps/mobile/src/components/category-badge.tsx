import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { labelForCategory, labelForGenre } from '@/features/library/categories';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

interface CategoryBadgeProps {
  /** Category slug from `classifyPack()` — known or forward-compatible unknown. */
  category: string;
  /** Genre slug (null/undefined = genre-less). Only consulted for `stories`. */
  genre?: string | null;
  /** `sm` = 14px icon in a pill; `md` = 16px icon + the Russian label. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Category / genre badge (M14 §5, T46 — UI_DESIGN component inventory):
 * the same glyph the Библиотека chips use, wherever a story is read or
 * found (reader header, search hits, bookmark cards, packs screen). A
 * fiction pack WITH a genre shows the genre (skull for horror, not the
 * generic book); everything else shows its category. Unknown slugs fall
 * through T44's `labelFor*` fallbacks (raw slug + generic icon).
 */
export function CategoryBadge({ category, genre, size = 'sm', className }: CategoryBadgeProps) {
  const { tokens } = useAppTheme();
  const label = category === 'stories' && genre ? labelForGenre(genre) : labelForCategory(category);
  if (size === 'md') {
    return (
      <View
        className={cn('flex-row items-center gap-1', className)}
        accessibilityLabel={label.ru}
        accessible
      >
        <Ionicons name={label.icon} size={16} color={tokens.textMuted} />
        <Text variant="caption">{label.ru}</Text>
      </View>
    );
  }
  return (
    <View
      className={cn('rounded-full bg-surface-2 p-1', className)}
      accessibilityLabel={label.ru}
      accessible
    >
      <Ionicons name={label.icon} size={14} color={tokens.textMuted} />
    </View>
  );
}
