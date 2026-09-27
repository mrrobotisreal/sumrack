import * as React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import type { Size } from './scene-geometry';

/**
 * The scene's measured box (T61, §8.1 / the T31 rule): children render only
 * once the box has a real size, and receive THAT size — never window dims —
 * so the same scene fits the run screen's 62 % band, the intro's full
 * screen, and T62's hub thumbnail. One layout pass, then stable (a
 * same-size relayout is a no-op setState).
 */
export function SceneBox({
  children,
  style,
  ...rest
}: { children: (box: Size) => React.ReactNode } & Omit<ViewProps, 'children'>) {
  const [box, setBox] = React.useState<Size | null>(null);
  return (
    <View
      {...rest}
      style={[styles.box, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) =>
          prev && prev.w === Math.round(width) && prev.h === Math.round(height)
            ? prev
            : { w: Math.round(width), h: Math.round(height) },
        );
      }}
    >
      {box && box.w > 0 && box.h > 0 ? children(box) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
