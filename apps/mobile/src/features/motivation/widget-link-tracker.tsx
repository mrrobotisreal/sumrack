import * as Linking from 'expo-linking';
import * as React from 'react';

import { track } from '@/services/analytics';

/**
 * Analytics for home-screen widget tap-throughs (T40). expo-router performs the
 * navigation itself; this component only observes the incoming URL and records
 * `widget_opened` once per URL when it carries `from=widget`. It never pushes a
 * route, so navigation can't happen twice.
 */

type WidgetScreen = 'daily' | 'reader' | 'app';

/**
 * Pure: the analytics screen for a sumrak:// URL, or null when it isn't a
 * widget tap. WHATWG URL parsing of a custom scheme puts the first segment in
 * the host (`sumrak://review/daily` → host `review`, path `/daily`), so the
 * route is host + path — reading the path alone never matched (S25 finding).
 */
export function widgetScreenFromUrl(url: string): WidgetScreen | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.searchParams.get('from') !== 'widget') return null;
  const path = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+|\/+$/g, '');
  if (path === 'review/daily') return 'daily';
  if (path.startsWith('reader/')) return 'reader';
  if (path === '' || path === '(tabs)') return 'app';
  return null;
}

export function WidgetLinkTracker() {
  React.useEffect(() => {
    let lastUrl: string | null = null;
    const handle = (url: string | null) => {
      if (!url || url === lastUrl) return;
      lastUrl = url;
      const screen = widgetScreenFromUrl(url);
      if (screen) track('widget_opened', { screen, from: 'widget' });
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
  return null;
}
