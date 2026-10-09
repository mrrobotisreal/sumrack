---
exam:
  id: a2-mock-fx
  format: torfl
  level: A2
  mode: mock
  title: { ru: 'Вариант ФХ (А2)', en: 'Fixture mock (A2)' }
  subtests:
    - id: writing
      kind: writing
      title: { ru: 'Письмо', en: 'Writing' }
      instructions: { ru: 'Время выполнения — 50 минут. Можно пользоваться словарём.', en: '50 minutes · dictionary allowed.' }
      durationMin: 50
      dictionary: true
      navigation: free
      maxPoints: 100
      parts:
        - id: p1
          instructions: { ru: 'Задание 1. Напишите письмо другу.', en: 'Task 1. Write a letter to a friend.' }
          items:
            - id: wr01
              kind: writing
              topic: write-letter
              task: { ru: 'Вы закончили курс русского языка. Напишите письмо другу и расскажите об этом.', en: 'You finished a Russian language course. Write a letter to a friend and tell them about it.' }
              bullets:
                - { id: b1, text: { ru: 'где и когда был курс', en: 'where and when the course was' }, cues: ['курс'] }
                - { id: b2, text: { ru: 'сколько времени вы учили русский', en: 'how long you studied Russian' }, cues: ['месяц*', 'год*', 'недел*'] }
                - { id: b3, text: { ru: 'кто был преподавателем', en: 'who the teacher was' }, cues: ['преподават*', 'учител*'] }
                - { id: b4, text: { ru: 'что было самым трудным', en: 'what was the hardest part' }, cues: ['трудн*'] }
                - { id: b5, text: { ru: 'что вам понравилось', en: 'what you liked' }, cues: ['понрав*'] }
                - { id: b6, text: { ru: 'спросите друга, хочет ли он тоже учиться', en: 'ask your friend whether they want to study too' }, cues: ['хочешь', 'хочет'] }
              minSentences: 10
              minQuestions: 3
              maxQuestions: 5
        - id: p2
          instructions: { ru: 'Задание 2. Напишите сообщение.', en: 'Task 2. Write a message.' }
          items:
            - id: wr02
              kind: writing
              topic: write-note
              task: { ru: 'Напишите другу сообщение и предложите встретиться. Укажите причину, день, время и место.', en: 'Write a message to a friend and propose meeting. Give a reason, the day, the time and the place.' }
              bullets:
                - { id: b1, text: { ru: 'причина: почему вы не можете в другой день', en: 'reason: why you cannot make another day' }, cues: ['работ*', 'занят*'] }
                - { id: b2, text: { ru: 'какой день', en: 'which day' }, cues: ['суббот*', 'пятниц*', 'воскресен*'] }
                - { id: b3, text: { ru: 'во сколько', en: 'what time' }, cues: ['час*', 'утр*', 'вечер*'] }
                - { id: b4, text: { ru: 'где', en: 'where' }, cues: ['кафе', 'парк*', 'кинотеатр*'] }
              minSentences: 5
              model: { storyId: md-note }
    - id: lexgram
      kind: lexgram
      title: { ru: 'Лексика. Грамматика', en: 'Vocabulary. Grammar' }
      instructions: { ru: 'Время выполнения — 50 минут. Пользоваться словарём нельзя.', en: '50 minutes · no dictionary.' }
      durationMin: 50
      dictionary: false
      navigation: free
      pointsPerItem: 1
      maxPoints: 10
      parts:
        - id: p1
          instructions: { ru: 'Задания 1–5. Выберите один вариант ответа.', en: 'Items 1–5. Choose one answer.' }
          items:
            - { id: lg01, kind: choice, topic: lex-phrases, stem: 'Мне очень … , что я опоздал.', options: ['жаль', 'нравится', 'нужно'], answer: 0, explain: 'мне жаль — «I am sorry» (apology/regret); «нравится» is «likes», «нужно» is «need».' }
            - { id: lg02, kind: choice, topic: case-plural, stem: 'В этом магазине есть новые …', options: ['книги', 'книг', 'книгам'], answer: 0, explain: 'есть + plural noun in the accusative (= nominative for inanimate): новые книги.' }
            - { id: lg03, kind: choice, topic: numerals, stem: 'В классе двенадцать …', options: ['студентов', 'студенты', 'студента'], answer: 0, explain: 'numbers 5–20 take the genitive plural: двенадцать студентов.' }
            - { id: lg04, kind: choice, topic: case-time, stem: 'Концерт начинается в … часов вечера.', options: ['семь', 'семи'], answer: 0, explain: 'в + accusative for the clock time: в семь часов.' }
            - { id: lg05, kind: choice, topic: comparative, stem: 'Этот фильм … , чем тот.', options: ['интереснее', 'интересен', 'интересный'], answer: 0, explain: 'comparative with чем: интереснее, чем тот.' }
        - id: p2
          instructions: { ru: 'Задания 6–10. Выберите один вариант ответа.', en: 'Items 6–10. Choose one answer.' }
          items:
            - { id: lg06, kind: choice, topic: verb-motion-prefix, stem: 'Я … в магазин за хлебом.', options: ['пойду', 'приду', 'уйду'], answer: 0, explain: 'one-way trip to a place: пойду в магазин (приду = come to where the speaker is).' }
            - { id: lg07, kind: choice, topic: verb-aspect, stem: 'Каждый день я … письма.', options: ['пишу', 'напишу'], answer: 0, explain: 'a habitual action is imperfective: каждый день я пишу.' }
            - { id: lg08, kind: choice, topic: clauses, stem: 'Я не пошёл на работу, … был болен.', options: ['потому что', 'поэтому'], answer: 0, explain: 'потому что introduces the reason clause; поэтому gives the result.' }
            - { id: lg09, kind: choice, topic: case-prep, stem: 'Мой брат работает … почте.', options: ['в', 'на'], answer: 1, explain: 'на почте — «на» with post office, as with работа, радио.' }
            - { id: lg10, kind: choice, topic: case-prep, stem: 'Мы живём … Киеве.', options: ['в', 'на'], answer: 0, explain: 'в Киеве — «в» with a city.' }
    - id: reading
      kind: reading
      title: { ru: 'Чтение', en: 'Reading' }
      instructions: { ru: 'Время выполнения — 50 минут. Можно пользоваться словарём.', en: '50 minutes · dictionary allowed.' }
      durationMin: 50
      dictionary: true
      navigation: free
      pointsPerItem: 6
      maxPoints: 30
      parts:
        - id: p3
          instructions: { ru: 'Задания 1–5. Прочитайте тексты. Выберите один вариант ответа.', en: 'Items 1–5. Read the texts. Choose one answer.' }
          items:
            - { id: rd01, kind: choice, topic: read-match, passage: { storyId: rd-01 }, stem: 'Семья переехала в старый дом, и там начались странные звуки. Это фильм …', options: ['«Старый дом»', '«Зимний вечер»', '«Друг из Львова»'], answer: 0 }
            - { id: rd02, kind: choice, topic: read-match, passage: { storyId: rd-01 }, stem: 'Молодая женщина приехала в маленький город. Это фильм …', options: ['«Старый дом»', '«Зимний вечер»', '«Друг из Львова»'], answer: 1 }
            - { id: rd03, kind: choice, topic: read-match, passage: { storyId: rd-01 }, stem: 'Мальчик из Львова помог новому соседу. Это фильм …', options: ['«Старый дом»', '«Зимний вечер»', '«Друг из Львова»'], answer: 2 }
            - { id: rd04, kind: choice, topic: read-match, passage: { storyId: rd-01 }, stem: 'Этот фильм страшнее других фильмов этого года. Это фильм …', options: ['«Старый дом»', '«Зимний вечер»', '«Друг из Львова»'], answer: 0 }
            - { id: rd05, kind: choice, topic: read-match, passage: { storyId: rd-01 }, stem: 'Это добрый фильм, который можно смотреть вместе с семьёй. Это фильм …', options: ['«Старый дом»', '«Зимний вечер»', '«Друг из Львова»'], answer: 1 }
    - id: listening
      kind: listening
      title: { ru: 'Аудирование', en: 'Listening' }
      instructions: { ru: 'Время выполнения — 30 минут. Каждый текст звучит два раза.', en: '30 minutes · every text plays twice.' }
      durationMin: 30
      dictionary: false
      navigation: linear
      pointsPerItem: 6
      maxPoints: 18
      audioPlays: 2
      parts:
        - id: p4
          instructions: { ru: 'Задания 1–3. Прослушайте диалог Маши и Саши. Выберите один вариант ответа.', en: 'Items 1–3. Listen to Masha and Sasha. Choose one answer.' }
          items:
            - { id: ls01, kind: choice, topic: listen-goal, audio: { storyId: ls-01 }, stem: 'Друзья договариваются …', options: ['пойти в кино', 'пойти в театр', 'пойти в парк'], answer: 0 }
            - { id: ls02, kind: choice, topic: listen-detail, stem: 'Встреча будет в … часов.', options: ['пять', 'шесть', 'семь'], answer: 1 }
            - { id: ls03, kind: choice, topic: listen-detail, stem: 'Друзья встретятся в …', options: ['субботу', 'пятницу', 'воскресенье'], answer: 0 }
    - id: speaking
      kind: speaking
      title: { ru: 'Говорение', en: 'Speaking' }
      instructions: { ru: 'Время выполнения — 25 минут.', en: '25 minutes.' }
      durationMin: 25
      dictionary: false
      navigation: linear
      maxPoints: 100
      parts:
        - id: t1
          instructions: { ru: 'Задание 1. Ответьте на вопросы.', en: 'Task 1. Answer the questions.' }
          timeSec: 300
          items:
            - id: sp01
              kind: speaking-reply
              topic: speak-reply
              prompt: { storyId: ex-01, sentenceIds: [tfa2fx01e01-s01] }
              expect:
                slots:
                  - { kind: free, id: weekend, required: true, minTokens: 3, cues: ['обычно', 'выходн*'] }
                accept: ['Обычно я гуляю с друзьями.']
            - id: sp02
              kind: speaking-reply
              topic: speak-reply
              prompt: { storyId: ex-01, sentenceIds: [tfa2fx01e01-s02] }
              expect:
                slots:
                  - { kind: free, id: film, required: true, minTokens: 3, cues: ['фильм*'] }
                accept: ['Недавно я смотрел фильм «Старый дом».']
        - id: t2
          instructions: { ru: 'Задание 2. Прочитайте ситуацию и начните диалог.', en: 'Task 2. Read the situation and start the dialogue.' }
          timeSec: 300
          items:
            - id: sp03
              kind: speaking-situation
              topic: speak-situation
              prompt: { storyId: ex-01, sentenceIds: [tfa2fx01e01-s03] }
              situation: { ru: 'Ваш друг пригласил вас в кино, но вы заняты. Откажитесь и предложите другой день.', en: 'Your friend invited you to the cinema, but you are busy. Refuse and suggest another day.' }
              expect:
                slots:
                  - { kind: free, id: refuse, required: true, minTokens: 4, cues: ['извин*', 'занят*', 'не могу'] }
                accept: ['Извини, я занят. Давай в среду?']
            - id: sp04
              kind: speaking-situation
              topic: speak-situation
              prompt: { storyId: ex-01, sentenceIds: [tfa2fx01e01-s04] }
              situation: { ru: 'Вы хотите купить билеты в театр. Спросите, сколько они стоят.', en: 'You want to buy theatre tickets. Ask how much they cost.' }
              expect:
                slots:
                  - { kind: free, id: price, required: true, minTokens: 3, cues: ['сколько'] }
                accept: ['Сколько стоят билеты?']
        - id: t3
          instructions: { ru: 'Задание 3. Расскажите о празднике.', en: 'Task 3. Talk about a holiday.' }
          timeSec: 900
          items:
            - id: sp05
              kind: speaking-monologue
              topic: speak-monologue
              topicTitle: { ru: 'Мой любимый праздник', en: 'My favourite holiday' }
              questions:
                - { ru: 'Какой ваш любимый праздник?', cues: ['праздник*'] }
                - { ru: 'Когда он бывает?', cues: ['декабр*', 'январ*'] }
                - { ru: 'Как вы его празднуете?', cues: ['празднуем', 'праздную'] }
                - { ru: 'Кто бывает с вами?', cues: ['друз*', 'семь*', 'родител*'] }
                - { ru: 'Что вы едите и пьёте?', cues: ['ем', 'едим'] }
                - { ru: 'Что вам нравится больше всего?', cues: ['нравится', 'нравит*'] }
              minSentences: 12
              maxSentences: 15
              prepSec: 600
              answerSec: 300
---

Fixture mock A2 (T75) — mock-SHAPED: all five subtests in the official SPbU order,
official A2 durations / dictionary / navigation, but deliberately small item counts
(2 writing, 10 lexgram, 5 reading, 3 listening, 5 speaking = 25 items). The two
lexgram items 9–10 repeat the same two options in the same order (the «неполное
соответствие» pair). The reading items all point to rd-01 (the whole story) and
share its three film titles as options.
