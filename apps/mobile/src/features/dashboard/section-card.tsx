import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/** Shared dashboard card chrome — one look for every section (UI_DESIGN §4). */
export function SectionCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <View className="rounded-xl border border-border bg-surface p-4">
      <Text variant="caption" className="uppercase tracking-wider">
        {title}
      </Text>
      <View className="mt-3">{children}</View>
      {footer}
    </View>
  );
}

/** Consistent "not enough data yet" placeholder (ticket item 6). */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="muted" className="py-2">
      {children}
    </Text>
  );
}
