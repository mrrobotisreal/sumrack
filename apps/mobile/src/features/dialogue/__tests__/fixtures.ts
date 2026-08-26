import type {
  DialogueGraph,
  DialogueGraphChoice,
  DialogueGraphNode,
  DialogueRunPath,
  DialogueRunStep,
} from '@/db/repositories/dialogues';
import type { SentenceWithTokens } from '@/db/repositories/content';

/**
 * Test fixtures for the T27 engine/matching tests: a minimal typed graph
 * mirroring the a2-dialogue-001 «Ужин у мамы» shape (linear intro → choice
 * point → loop-capable choice point → three endings) without dragging the
 * real pack JSON through the Drizzle row types.
 */

const PACK = 'test-pack';
const DIALOGUE = 'test-dialogue';

export function sentence(id: string, ru: string, lemmas?: (string | null)[]): SentenceWithTokens {
  const words = ru.split(/\s+/).filter(Boolean);
  return {
    packId: PACK,
    id,
    storyId: DIALOGUE,
    orderIdx: 0,
    ru,
    en: `EN of ${ru}`,
    grammarTopics: null,
    tokens: words.map((w, i) => {
      const text = w.replace(/[.,!?]/g, '');
      return {
        packId: PACK,
        sentenceId: id,
        tokenIndex: i,
        storyId: DIALOGUE,
        text,
        textNorm: text.toLowerCase().replace(/ё/g, 'е'),
        isPunct: false,
        spaceBefore: i > 0,
        lemma: lemmas?.[i] ?? text.toLowerCase(),
        lemmaNorm: (lemmas?.[i] ?? text).toLowerCase().replace(/ё/g, 'е'),
        translation: 'gloss',
        pos: null,
        grammar: null,
        level: null,
        note: null,
      };
    }),
  };
}

export function choice(
  id: string,
  nodeId: string,
  ru: string,
  nextNodeId: string,
  opts: { asrAlternates?: string[]; hintEn?: string } = {},
): DialogueGraphChoice {
  return {
    packId: PACK,
    dialogueId: DIALOGUE,
    nodeId,
    id,
    orderIdx: 0,
    sentenceId: `${id}-sent`,
    nextNodeId,
    asrAlternates: opts.asrAlternates ?? null,
    hintRu: null,
    hintEn: opts.hintEn ?? null,
    sentence: sentence(`${id}-sent`, ru),
    audio: null,
  };
}

export function node(
  id: string,
  speakerId: string,
  ru: string,
  cont: { next?: string; endingId?: string; choices?: DialogueGraphChoice[] },
): DialogueGraphNode {
  return {
    packId: PACK,
    dialogueId: DIALOGUE,
    id,
    orderIdx: 0,
    speakerId,
    sentenceId: `${id}-sent`,
    kind: cont.choices ? 'choices' : cont.next ? 'next' : 'ending',
    nextNodeId: cont.next ?? null,
    endingId: cont.endingId ?? null,
    sentence: sentence(`${id}-sent`, ru),
    audio: null,
    choices: cont.choices ?? [],
  };
}

export const graph: DialogueGraph = {
  dialogue: {
    packId: PACK,
    id: DIALOGUE,
    orderIdx: 0,
    titleRu: 'Ужин',
    titleEn: 'Dinner',
    level: 'A2',
    startNodeId: 'n1',
    characters: [
      { id: 'mama', name: { ru: 'Мама', en: 'Mama' }, voice: 'v1', style: 'warm' },
      { id: 'player', name: { ru: 'Ты', en: 'You' }, voice: 'coach', style: 'neutral' },
    ],
  },
  nodes: [
    node('n1', 'mama', 'Проходи, дорогой!', { next: 'n2' }),
    node('n2', 'mama', 'Ты голодный?', {
      choices: [
        choice('c-yes', 'n2', 'Да, я очень голодный.', 'n3', { asrAlternates: ['Да, очень.'] }),
        choice('c-no', 'n2', 'Нет, спасибо, я не голодный.', 'n4', {
          hintEn: 'A polite refusal.',
        }),
      ],
    }),
    node('n3', 'mama', 'Отлично, я сделала борщ!', { next: 'n6' }),
    node('n4', 'mama', 'Ничего, борщ уже на столе.', { next: 'n6' }),
    node('n6', 'mama', 'Хочешь ещё борща?', {
      choices: [
        choice('c-more', 'n6', 'Да, можно ещё немного.', 'n7'),
        choice('c-stop', 'n6', 'Спасибо, я сыт.', 'n5'),
      ],
    }),
    node('n7', 'mama', 'Кушай, кушай!', { next: 'n6' }),
    node('n5', 'mama', 'Молодец, приходи ещё.', { endingId: 'end-good' }),
  ],
  endings: [
    {
      packId: PACK,
      dialogueId: DIALOGUE,
      id: 'end-good',
      titleRu: 'Хороший ужин',
      titleEn: 'A good dinner',
      recapRu: 'Все довольны.',
      recapEn: 'Everyone is happy.',
      tone: 'good',
    },
  ],
};

export function path(steps: DialogueRunStep[]): DialogueRunPath {
  return { v: 1, steps };
}
