/**
 * Tiny setter bridge for the home-screen widget refresh (T40). The motivation
 * service runs under vitest, where importing the device writer (`@/db`) would
 * open the native database — so the service calls `requestWidgetRefresh()`
 * here and the provider installs the real writer at boot (same pattern as
 * `services/motivation-bus.ts`). Before install, requests are dropped
 * deliberately: the boot path refreshes the snapshot anyway.
 */
type WidgetRefresher = () => void;

let refresher: WidgetRefresher | null = null;

export function setWidgetRefresher(fn: WidgetRefresher | null): void {
  refresher = fn;
}

export function requestWidgetRefresh(): void {
  try {
    refresher?.();
  } catch {
    // Fire-and-forget: a widget refresh must never break the caller's write path.
  }
}
