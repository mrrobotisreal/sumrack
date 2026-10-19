import { foldForAnswer } from '@/lib/text';

/**
 * Free-word-order acceptance for the sentence builder (pure). Russian marks
 * roles with case, so «и на меня идёт туман» and «и туман идёт на меня» say
 * the same thing; only the authored order used to pass. The sentence is cut
 * into clauses (at punctuation and before a conjunction, which stays clause-
 * initial; clauses keep their order) and each clause into chunks that can't
 * be split: a preposition / «не» / other proclitic particle travels with the
 * next word, an enclitic («же», «ли», «бы») with the previous one, and an
 * adjective / numeral with the noun right after it («два дома» ≠ «дома два»).
 * Any order of whole chunks inside a clause is accepted.
 */

export interface OrderToken {
  text: string;
  isPunct: boolean;
  pos?: string | null;
}

/** Fallbacks for tokens authored without a `pos`. */
const PREPOSITIONS = new Set(
  'в во на с со к ко о об обо у из от до по за под подо над перед при про без для через между около после кроме вокруг против среди сквозь из-за из-под'
    .split(' ')
    .map(foldForAnswer),
);
const CONJUNCTIONS = new Set(['и', 'а', 'но', 'или', 'да']);
const PROCLITICS = new Set(['не', 'ни']);
const ENCLITICS = new Set(['же', 'ж', 'ли', 'ль', 'бы', 'б']);

/** Long-form adjectives (short ones are tagged «adj (short)») and numerals bind to a following noun. */
const isModifier = (pos: string) => pos === 'adj' || pos === 'num';
const isNominal = (pos: string) => pos === 'noun' || pos === 'name' || isModifier(pos);

interface Clause {
  lead: string[];
  chunks: string[][];
}

function toClauses(tokens: readonly OrderToken[]): Clause[] {
  const clauses: Clause[] = [];
  let cur: Clause = { lead: [], chunks: [] };
  let pending: string[] = [];
  /** The last chunk ends in a modifier still waiting for its noun. */
  let openModifier = false;
  const close = () => {
    openModifier = false;
    if (pending.length) cur.chunks.push(pending);
    pending = [];
    if (cur.lead.length || cur.chunks.length) clauses.push(cur);
    cur = { lead: [], chunks: [] };
  };
  for (const t of tokens) {
    if (t.isPunct) {
      close();
      continue;
    }
    const w = foldForAnswer(t.text);
    if (!w) continue;
    const pos = t.pos ?? '';
    if (ENCLITICS.has(w)) {
      const host = cur.chunks.at(-1) ?? (cur.lead.length ? cur.lead : null);
      if (host && !pending.length) {
        host.push(w);
        continue;
      }
    }
    if (pos.startsWith('conj') || (!pos && CONJUNCTIONS.has(w))) {
      close();
      cur.lead.push(w);
    } else if (
      pos.startsWith('prep') ||
      pos === 'part' ||
      PROCLITICS.has(w) ||
      (!pos && PREPOSITIONS.has(w))
    ) {
      pending.push(w);
      openModifier = false;
    } else if (openModifier && !pending.length && isNominal(pos)) {
      cur.chunks.at(-1)!.push(w);
      openModifier = isModifier(pos);
    } else {
      cur.chunks.push([...pending, w]);
      pending = [];
      openModifier = isModifier(pos);
    }
  }
  close();
  return clauses;
}

/** Can `words` be tiled exactly by `chunks`, each used once, in any order? */
function tiles(words: string[], chunks: string[][], used: boolean[], at = 0): boolean {
  if (at === words.length) return used.every(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    if (used[i] || !c.every((w, k) => words[at + k] === w)) continue;
    used[i] = true;
    if (tiles(words, chunks, used, at + c.length)) return true;
    used[i] = false;
  }
  return false;
}

/** True when `chosen` (tile texts) is the sentence with its chunks reordered within clauses. */
export function flexibleOrderMatch(
  chosen: readonly string[],
  tokens: readonly OrderToken[],
): boolean {
  const words = chosen.map(foldForAnswer);
  let at = 0;
  for (const { lead, chunks } of toClauses(tokens)) {
    const len = lead.length + chunks.reduce((n, c) => n + c.length, 0);
    const slice = words.slice(at, at + len);
    if (slice.length !== len || !lead.every((w, k) => slice[k] === w)) return false;
    if (
      !tiles(
        slice.slice(lead.length),
        chunks,
        chunks.map(() => false),
      )
    )
      return false;
    at += len;
  }
  return at === words.length;
}
