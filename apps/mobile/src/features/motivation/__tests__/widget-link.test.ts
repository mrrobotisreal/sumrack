import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-linking', () => ({}));
vi.mock('@/services/analytics', () => ({ track: () => undefined }));

import { widgetScreenFromUrl } from '../widget-link-tracker';

/** T40: widget tap-through URLs → `widget_opened` screen (the exact URLs the Kotlin widget emits). */
describe('widgetScreenFromUrl', () => {
  it('maps the daily-session tap (first segment parses as the URL host)', () => {
    expect(widgetScreenFromUrl('sumrak://review/daily?from=widget')).toBe('daily');
  });

  it('maps the continue-reading tap with encoded ids', () => {
    expect(widgetScreenFromUrl('sumrak://reader/a1-course-unit-001/the-wardrobe?from=widget')).toBe(
      'reader',
    );
    expect(widgetScreenFromUrl('sumrak://reader/p%20x/s%2F1?from=widget')).toBe('reader');
  });

  it('maps the placeholder tap to the app', () => {
    expect(widgetScreenFromUrl('sumrak://?from=widget')).toBe('app');
  });

  it('ignores non-widget links and junk', () => {
    expect(widgetScreenFromUrl('sumrak://review/daily')).toBeNull();
    expect(widgetScreenFromUrl('sumrak://review/daily?from=notification')).toBeNull();
    expect(widgetScreenFromUrl('sumrak://settings?from=widget')).toBeNull();
    expect(widgetScreenFromUrl('not a url')).toBeNull();
  });
});
