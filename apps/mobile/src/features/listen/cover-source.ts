/**
 * Cover art source choice (FULL_STORY_LISTEN §2.2): the pack's staged JPEG when
 * present, else the bundled app icon — never a broken image, never a network fetch.
 */
export type CoverChoice = { kind: 'file'; uri: string } | { kind: 'icon' };

export function coverChoice(coverUri: string | null | undefined): CoverChoice {
  return coverUri ? { kind: 'file', uri: coverUri } : { kind: 'icon' };
}
