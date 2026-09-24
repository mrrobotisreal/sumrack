import { repos } from '@/db';
import { normalizeRu } from '@/db/normalize';
import type { DialogueGraphChoice } from '@/db/repositories/dialogues';
import { recordReviewOutcome } from '@/features/motivation/service';
import { pronunciationScoreToRating } from '@/features/pronunciation/scoring';

/**
 * FSRS write for a SPOKEN choice (T27, V2 §3.3): one `production` rating —
 * the T12 mapping (≥80 Good / 50–79 Hard / <50 Again, Easy never) on the
 * ASR match score — for each of the choice's lemmas that already has a bank
 * item. Never auto-creates items (dialogue lines are content, not
 * collections); tapped choices never reach this function. Grades run
 * through the standard `reviews.gradeCard` pipeline + motivation bump, so
 * XP/goal accounting matches every other mode by construction.
 */
export async function gradeSpokenChoice(
  choice: DialogueGraphChoice,
  score: number,
): Promise<number> {
  const sentence = choice.sentence;
  if (!sentence) return 0;
  const rating = pronunciationScoreToRating(score);

  const seen = new Set<string>();
  let graded = 0;
  for (const token of sentence.tokens) {
    if (token.isPunct) continue;
    // Same effective-lemma rule as the word popup: lemma, else surface.
    const lemma = token.lemma ?? token.text;
    const norm = normalizeRu(lemma);
    if (seen.has(norm)) continue;
    seen.add(norm);

    const item = await repos.bank.findWordByLemma(lemma);
    if (!item) continue;
    const card = await repos.reviews.getCard(item.id, 'production');
    if (!card) continue;
    await repos.reviews.gradeCard(card.id, rating, { source: 'dialogue' });
    await recordReviewOutcome(rating);
    graded += 1;
  }
  return graded;
}
