/**
 * Mechanically tokenize a short test sentence: words split on spaces, each
 * trailing/leading punctuation mark its own token. Only for building
 * structurally valid test sentences — real content is authored by hand.
 */
export function makeSentence(id: string, ru: string): Record<string, unknown> {
  const tokens: Record<string, unknown>[] = [];
  for (const chunk of ru.split(' ')) {
    const m = /^([«]*)([^«»]*?)([.,!?…»]*)$/u.exec(chunk)!;
    for (const p of m[1] ?? '') tokens.push({ text: p, isPunct: true });
    if (m[2]) {
      const tok: Record<string, unknown> = {
        text: m[2],
        lemma: m[2].toLowerCase(),
        translation: 'x',
        pos: 'noun',
        level: 'A1',
      };
      if (tokens.length > 0 && tokens[tokens.length - 1]!.text === '«') tok.spaceBefore = false;
      tokens.push(tok);
    }
    for (const p of m[3] ?? '') tokens.push({ text: p, isPunct: true });
  }
  const first = tokens[0];
  if (first && first.isPunct !== true) delete first.spaceBefore;
  return { id, ru, en: 'test', tokens };
}

/** A dialogue node for tests: one of `next`/`endingId`/`choices` via `rest`. */
export function makeNode(
  id: string,
  speakerId: string,
  ru: string,
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return { id, speakerId, sentence: makeSentence(id, ru), ...rest };
}

/** A choice for tests (sentence id = choice id, the pipeline convention). */
export function makeChoice(id: string, ru: string, next: string): Record<string, unknown> {
  return { id, sentence: makeSentence(id, ru), next };
}

/**
 * A minimal, structurally valid `dialogue` pack for tests to mutate:
 * n1 → n2 (choice point: c1 → n3 ⇒ e-good, c2 → n4 ⇒ e-bad).
 */
export function makeValidDialoguePack(): Record<string, unknown> {
  return structuredClone({
    id: 'test-dialogue-001',
    version: 1,
    type: 'dialogue',
    title: { ru: 'Тест', en: 'Test' },
    level: 'A1',
    tags: ['test', 'dialogue'],
    stories: [],
    dialogues: [
      {
        id: 'test-dlg',
        title: { ru: 'Тест', en: 'Test' },
        level: 'A1',
        characters: [
          {
            id: 'mama',
            name: { ru: 'Мама', en: 'Mama' },
            voice: 'elevenlabs:Mariia',
            style: 'warm',
          },
          {
            id: 'player',
            name: { ru: 'Ты', en: 'You' },
            voice: 'elevenlabs:Ivan',
            style: 'neutral',
          },
        ],
        startNodeId: 'dlg-n1',
        nodes: [
          makeNode('dlg-n1', 'mama', 'Привет.', { next: 'dlg-n2' }),
          makeNode('dlg-n2', 'mama', 'Ты голодный?', {
            choices: [
              makeChoice('dlg-n2-c1', 'Да.', 'dlg-n3'),
              makeChoice('dlg-n2-c2', 'Нет.', 'dlg-n4'),
            ],
          }),
          makeNode('dlg-n3', 'mama', 'Хорошо.', { endingId: 'e-good' }),
          makeNode('dlg-n4', 'mama', 'Ладно.', { endingId: 'e-bad' }),
        ],
        endings: [
          {
            id: 'e-good',
            title: { ru: 'Хорошо', en: 'Good' },
            recap: { ru: 'Всё хорошо.', en: 'All good.' },
            tone: 'good',
          },
          {
            id: 'e-bad',
            title: { ru: 'Плохо', en: 'Bad' },
            recap: { ru: 'Всё плохо.', en: 'All bad.' },
            tone: 'bad',
          },
        ],
      },
    ],
  });
}

/** A minimal, structurally valid `stories` pack for tests to mutate. */
export function makeValidPack(): Record<string, unknown> {
  return structuredClone({
    id: 'test-pack-001',
    version: 1,
    type: 'stories',
    title: { ru: 'Тест', en: 'Test' },
    level: 'A1',
    tags: ['test'],
    stories: [
      {
        id: 'test-story',
        title: { ru: 'Тест', en: 'Test' },
        level: 'A1',
        audio: [],
        sentences: [
          {
            id: 'test-s01',
            ru: 'Я дома.',
            en: 'I am home.',
            tokens: [
              {
                text: 'Я',
                lemma: 'я',
                translation: 'I',
                pos: 'pron',
                grammar: 'nom.',
                level: 'A1',
              },
              { text: 'дома', lemma: 'дома', translation: 'at home', pos: 'adv', level: 'A1' },
              { text: '.', isPunct: true },
            ],
          },
        ],
      },
    ],
  });
}

/** A scenario line for tests: sentence id = the line's own id. */
export function makeLine(id: string, ru: string): Record<string, unknown> {
  return { sentence: makeSentence(id, ru) };
}

/**
 * A minimal, structurally valid `scenario` pack for tests to mutate (T56):
 * t1 (monologue) → t2 (free slot «name») → t3 (forms slot «mood», branches
 * good → t4g · bad → t4b · default → t4d) → each ⇒ e-ok. One glossary entry,
 * three nudges, a placeholder host, no audio.
 */
export function makeValidScenarioPack(): Record<string, unknown> {
  const retry = (id: string) => ({
    confused: makeLine(`${id}-conf`, 'Не понял.'),
    hint: makeLine(`${id}-hint`, 'Скажите ещё раз.'),
    lifeline: { ru: 'Скажи.', en: 'Say it.' },
  });
  return structuredClone({
    id: 'test-scenario-001',
    version: 1,
    type: 'scenario',
    title: { ru: 'Тест', en: 'Test' },
    level: 'A1',
    tags: ['test', 'scenario'],
    stories: [],
    scenarios: [
      {
        id: 'scn',
        familyId: 'test',
        title: { ru: 'Тест', en: 'Test' },
        level: 'A1',
        language: 'ru',
        brief: { ru: 'Проверка.', en: 'A check.' },
        cast: [
          {
            id: 'host',
            name: { ru: 'Ведущий', en: 'Host' },
            voice: 'elevenlabs:Maxim',
            style: 'warm',
            role: 'host',
            portrait: { mouthStyle: 'default', placeholder: { kind: 'man', hue: 25 } },
          },
          {
            id: 'player',
            name: { ru: 'Ты', en: 'You' },
            voice: 'elevenlabs:Ivan',
            style: 'neutral',
            role: 'player',
          },
        ],
        scene: { accent: '#c26a3a', bed: 'studio', layout: 'center' },
        startTurnId: 'scn-t1',
        turns: [
          { id: 'scn-t1', speakerId: 'host', say: [makeLine('scn-t1', 'Привет.')], next: 'scn-t2' },
          {
            id: 'scn-t2',
            speakerId: 'host',
            say: [makeLine('scn-t2', 'Как вас зовут?')],
            expect: {
              slots: [{ kind: 'free', id: 'name', required: true, minTokens: 1 }],
              accept: ['Меня зовут Митч.'],
            },
            retry: retry('scn-t2'),
            next: 'scn-t3',
          },
          {
            id: 'scn-t3',
            speakerId: 'host',
            say: [makeLine('scn-t3', 'Как дела?')],
            expect: {
              slots: [
                {
                  kind: 'forms',
                  id: 'mood',
                  required: true,
                  options: [
                    { key: 'good', lemma: 'хорошо', forms: ['хорошо', 'отлично'] },
                    { key: 'bad', lemma: 'плохо', forms: ['плохо', 'устал*'] },
                  ],
                  acceptsNumber: false,
                },
              ],
              accept: ['Хорошо, спасибо.'],
              branchOn: 'mood',
            },
            retry: retry('scn-t3'),
            next: { on: { good: 'scn-t4g', bad: 'scn-t4b' }, default: 'scn-t4d' },
          },
          {
            id: 'scn-t4g',
            speakerId: 'host',
            say: [makeLine('scn-t4g', 'Рад.')],
            endingId: 'e-ok',
          },
          {
            id: 'scn-t4b',
            speakerId: 'host',
            say: [makeLine('scn-t4b', 'Жаль.')],
            endingId: 'e-ok',
          },
          {
            id: 'scn-t4d',
            speakerId: 'host',
            say: [makeLine('scn-t4d', 'Ясно.')],
            endingId: 'e-ok',
          },
        ],
        endings: [
          {
            id: 'e-ok',
            title: { ru: 'Готово', en: 'Done' },
            recap: { ru: 'Всё.', en: 'All done.' },
            tone: 'good',
          },
        ],
        glossary: [
          {
            id: 'gl-privet',
            ru: 'привет',
            en: 'hello',
            forms: ['привет'],
            translit: ['хелоу'],
            explain: makeLine('gl-privet-ex', 'Привет — это hello.'),
            howToSay: makeLine('gl-privet-how', 'Hello — по-русски привет.'),
          },
        ],
        nudges: [
          { kind: 'silence', speakerId: 'host', line: makeLine('nudge-silence', 'Вы там?') },
          {
            kind: 'which-word',
            speakerId: 'host',
            line: makeLine('nudge-which-word', 'Какое слово?'),
          },
          { kind: 'dont-know', speakerId: 'host', line: makeLine('nudge-dont-know', 'Не знаю.') },
        ],
      },
    ],
  });
}

const L = (ru: string, en = ru): Record<string, unknown> => ({ ru, en });

/** A minimal speaking expectation (one forms slot + one paraphrase). */
export function makeExpect(): Record<string, unknown> {
  return {
    slots: [
      {
        kind: 'forms',
        id: 'city',
        required: true,
        options: [{ key: 'moscow', lemma: 'Москва', forms: ['москв*'] }],
      },
    ],
    accept: ['Я живу в Москве.'],
  };
}

/**
 * A minimal, structurally valid `exam` pack for tests to mutate (T67): two
 * stories (`rd-01` reading text, `ls-01` listening script) and one A1 `mock`
 * exam with all five subtests in the official order — lexgram 2 × 1 = 2 pts,
 * reading 2 × 4 = 8 pts (passage ref with a contiguous span), listening
 * 2 × 5 = 10 pts (second item inherits the first's audio), writing 1 letter,
 * speaking reply + situation + a monologue group of two. No audio.
 */
export function makeValidExamPack(): Record<string, unknown> {
  const instr = L('Выберите один вариант ответа.', 'Choose one answer.');
  const monologue = (id: string, title: string) => ({
    id,
    kind: 'speaking-monologue',
    topic: 'speak-monologue',
    group: 'g1',
    topicTitle: L(title),
    questions: [
      { ru: 'Как вас зовут?', cues: ['зовут'] },
      { ru: 'Откуда вы?', cues: ['из'] },
      { ru: 'Где вы живёте?', cues: ['живу'] },
      { ru: 'Кем вы работаете?', cues: ['работаю'] },
    ],
  });
  return structuredClone({
    id: 'a1-exam-test',
    version: 1,
    type: 'exam',
    title: L('Тест', 'Test'),
    level: 'A1',
    tags: ['torfl'],
    category: 'torfl',
    stories: [
      {
        id: 'rd-01',
        title: L('Текст', 'Text'),
        level: 'A1',
        audio: [],
        sentences: [
          makeSentence('tfa1t01r01-s01', 'Меня зовут Анна.'),
          makeSentence('tfa1t01r01-s02', 'Я живу в Москве.'),
          makeSentence('tfa1t01r01-s03', 'Я работаю в банке.'),
        ],
      },
      {
        id: 'ls-01',
        title: L('Диалог', 'Dialogue'),
        level: 'A1',
        audio: [],
        sentences: [
          makeSentence('tfa1t01l01-s01', 'Привет, Саша!'),
          makeSentence('tfa1t01l01-s02', 'Привет, Маша!'),
        ],
      },
    ],
    exams: [
      {
        id: 'a1-mock-t',
        format: 'torfl',
        level: 'A1',
        mode: 'mock',
        title: L('Вариант Т', 'Mock T'),
        subtests: [
          {
            id: 'writing',
            kind: 'writing',
            title: L('Письмо', 'Writing'),
            instructions: L('30 минут.', '30 minutes.'),
            durationMin: 30,
            dictionary: true,
            navigation: 'free',
            maxPoints: 100,
            parts: [
              {
                id: 'p1',
                instructions: L('Напишите письмо.', 'Write a letter.'),
                items: [
                  {
                    id: 'wr01',
                    kind: 'writing',
                    topic: 'write-letter',
                    task: L('Напишите письмо другу.', 'Write to a friend.'),
                    bullets: [
                      { id: 'b1', text: L('как вас зовут'), cues: ['зовут'] },
                      { id: 'b2', text: L('где вы живёте'), cues: ['живу'] },
                      { id: 'b3', text: L('где вы работаете'), cues: ['работаю', 'работа*'] },
                    ],
                    minSentences: 10,
                    minQuestions: 2,
                    maxQuestions: 5,
                  },
                ],
              },
            ],
          },
          {
            id: 'lexgram',
            kind: 'lexgram',
            title: L('Лексика. Грамматика', 'Vocabulary. Grammar'),
            instructions: L('40 минут.', '40 minutes.'),
            durationMin: 40,
            dictionary: false,
            navigation: 'free',
            pointsPerItem: 1,
            maxPoints: 2,
            parts: [
              {
                id: 'p1',
                instructions: instr,
                items: [
                  {
                    id: 'lg01',
                    kind: 'choice',
                    topic: 'case-prep',
                    stem: 'Нина играет … компьютере.',
                    options: ['в', 'на'],
                    answer: 1,
                    explain: 'играть на компьютере',
                  },
                  {
                    id: 'lg02',
                    kind: 'typed',
                    topic: 'case-prep',
                    prompt: 'Я живу в (Москва).',
                    accept: ['москве'],
                    half: ['москва'],
                  },
                ],
              },
            ],
          },
          {
            id: 'reading',
            kind: 'reading',
            title: L('Чтение', 'Reading'),
            instructions: L('40 минут.', '40 minutes.'),
            durationMin: 40,
            dictionary: true,
            navigation: 'free',
            pointsPerItem: 4,
            maxPoints: 8,
            parts: [
              {
                id: 'p4',
                instructions: instr,
                items: [
                  {
                    id: 'rd01',
                    kind: 'choice',
                    topic: 'read-detail',
                    passage: {
                      storyId: 'rd-01',
                      sentenceIds: ['tfa1t01r01-s01', 'tfa1t01r01-s02'],
                    },
                    stem: 'Анна живёт в …',
                    options: ['Москве', 'Казани', 'Сочи'],
                    answer: 0,
                  },
                  {
                    id: 'rd02',
                    kind: 'choice',
                    topic: 'read-detail',
                    passage: { storyId: 'rd-01' },
                    stem: 'Анна работает в …',
                    options: ['школе', 'банке', 'магазине'],
                    answer: 1,
                  },
                ],
              },
            ],
          },
          {
            id: 'listening',
            kind: 'listening',
            title: L('Аудирование', 'Listening'),
            instructions: L('30 минут.', '30 minutes.'),
            durationMin: 30,
            dictionary: false,
            navigation: 'linear',
            pointsPerItem: 5,
            maxPoints: 10,
            audioPlays: 2,
            parts: [
              {
                id: 'p3',
                instructions: instr,
                items: [
                  {
                    id: 'ls01',
                    kind: 'choice',
                    topic: 'listen-who',
                    audio: { storyId: 'ls-01' },
                    stem: 'Саша и Маша …',
                    options: ['друзья', 'брат и сестра', 'коллеги'],
                    answer: 0,
                  },
                  {
                    id: 'ls02',
                    kind: 'choice',
                    topic: 'listen-detail',
                    stem: 'Кто говорит первым?',
                    options: ['Маша', 'Саша', 'Анна'],
                    answer: 0,
                  },
                ],
              },
            ],
          },
          {
            id: 'speaking',
            kind: 'speaking',
            title: L('Говорение', 'Speaking'),
            instructions: L('20 минут.', '20 minutes.'),
            durationMin: 20,
            dictionary: false,
            navigation: 'linear',
            maxPoints: 100,
            parts: [
              {
                id: 't1',
                instructions: L('Ответьте.', 'Reply.'),
                timeSec: 300,
                items: [
                  {
                    id: 'sp01',
                    kind: 'speaking-reply',
                    topic: 'speak-reply',
                    prompt: { storyId: 'ls-01', sentenceIds: ['tfa1t01l01-s01'] },
                    expect: makeExpect(),
                  },
                ],
              },
              {
                id: 't2',
                instructions: L('Начните диалог.', 'Start the dialogue.'),
                timeSec: 300,
                items: [
                  {
                    id: 'sp02',
                    kind: 'speaking-situation',
                    topic: 'speak-situation',
                    prompt: { storyId: 'ls-01', sentenceIds: ['tfa1t01l01-s02'] },
                    situation: L('Вы в кафе.', 'You are in a café.'),
                    expect: makeExpect(),
                  },
                ],
              },
              {
                id: 't3',
                instructions: L('Монолог.', 'Monologue.'),
                timeSec: 600,
                items: [monologue('sp03', 'О себе'), monologue('sp04', 'Мой дом')],
              },
            ],
          },
        ],
      },
    ],
  });
}
