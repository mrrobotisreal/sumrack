import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { logError } from '@/services/error-log';

interface CrashGuardState {
  error: Error | null;
}

/**
 * Top-level error boundary (T22). Catches render-phase errors from any
 * screen so a single broken screen degrades to this recoverable surface
 * instead of a hard crash. Every caught error lands in the local error
 * log (Settings → Diagnostics → Error log).
 *
 * NativeWind token classes work here (compile-time transform, no hook
 * needed), so the fallback matches the active theme.
 */
export class CrashGuard extends React.Component<{ children: React.ReactNode }, CrashGuardState> {
  state: CrashGuardState = { error: null };

  static getDerivedStateFromError(error: Error): CrashGuardState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack = info.componentStack
      ? `${error.stack ?? ''}\n--- component stack ---${info.componentStack}`
      : error.stack;
    logError('render', Object.assign(new Error(error.message), { stack, name: error.name }));
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View className="flex-1 items-center justify-center bg-bg px-6">
        <Text className="font-display text-3xl text-accent">Сумрак</Text>
        <Text variant="title" className="mt-6 text-center">
          Something broke
        </Text>
        <Text variant="muted" className="mt-2 text-center">
          The screen hit an error it couldn&apos;t recover from. Your data is safe — this only
          affects what&apos;s on screen.
        </Text>
        <ScrollView
          className="mt-4 max-h-32 self-stretch rounded-xl border border-border bg-surface"
          contentContainerClassName="p-3"
        >
          <Text variant="caption" className="font-mono text-xs">
            {this.state.error.message}
          </Text>
        </ScrollView>
        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          className="mt-6 min-h-12 items-center justify-center rounded-xl bg-accent px-8 py-3 active:opacity-80"
        >
          <Text className="font-ui-medium text-white">Try again</Text>
        </Pressable>
        <Text variant="caption" className="mt-4 text-center">
          Details were saved to the error log (Settings → Diagnostics).
        </Text>
      </View>
    );
  }
}
