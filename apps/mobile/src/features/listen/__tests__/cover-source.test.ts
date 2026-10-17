import { describe, expect, it } from 'vitest';

import { coverChoice } from '../cover-source';

describe('coverChoice', () => {
  it('falls back to the app icon when coverUri is null/empty', () => {
    expect(coverChoice(null)).toEqual({ kind: 'icon' });
    expect(coverChoice(undefined)).toEqual({ kind: 'icon' });
    expect(coverChoice('')).toEqual({ kind: 'icon' });
  });
  it('uses the staged file otherwise', () => {
    expect(coverChoice('file:///c.jpg')).toEqual({ kind: 'file', uri: 'file:///c.jpg' });
  });
});
