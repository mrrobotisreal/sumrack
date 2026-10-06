import { ruPlural } from './hub-model';

/**
 * «Добавить все слова в Словарь» (T69, TORFL §5.4) — the pure parts: which
 * stories offer the action, the toast copy, and the analytics topic slug.
 * Generic code gated to the `torfl:lexicon` tag so it never appears on a
 * creepypasta. The write itself is `repos.bank.bankLemmasFromStory`.
 */

export const LEXICON_TAG = 'torfl:lexicon';

/** The reader shows the action only on a `torfl` pack tagged `torfl:lexicon`. */
export function canBankTopic(pack: { category: string | null; tags: readonly string[] }): boolean {
  return pack.category === 'torfl' && pack.tags.includes(LEXICON_TAG);
}

const WORDS = ['слово', 'слова', 'слов'] as const;

/** «+12 слов» / «+0 слов — всё уже в Словаре». */
export function bankTopicToast(added: number): string {
  return added === 0
    ? '+0 слов — все слова уже в Словаре'
    : `+${added} ${ruPlural(added, WORDS)} в Словаре`;
}

/** `torfl_topic_banked.topic` = the story id slug minus the lexicon's `lx-` prefix. */
export function topicSlugOfStory(storyId: string): string {
  return storyId.replace(/^lx-/, '');
}
