---
pack:
  id: a1-hotel-fixture
  version: 1
  type: course
  title: { ru: "Отель «Сумрак»: тестовый этаж", en: "Hotel Sumrak: fixture floor" }
  level: A1
  tags: ["torfl", "torfl:fixture", "hotel"]
course:
  ladder: torfl
  level: A1
  floor: 3
  title: { ru: "Где? О чём?", en: "Where? About what?" }
  subtitle: { ru: "Предложный падеж", en: "Prepositional case" }
  gate:
    passPercent: 80
    extern:
      passPercent: 90
  practice:
    - packId: a1-torfl-lexgram-001
      examId: lg-case-prep
  units:
  - id: u1
    title: { ru: "в + где?", en: "в + where?" }
    summary: { en: "In + where takes the prepositional case: в + -е." }
    cards:
    - id: u1-x1
      kind: explain
      title: { ru: "В + предложный: мужской и средний род", en: "In + prepositional: masculine and neuter" }
      body: |
        The prepositional case (предложный падеж) answers the question где? (where?) after the preposition в.
        The ending is -е for most masculine and neuter nouns (в городе, в банке, в доме).
        Feminine nouns ending in -а or -я change to -е (в школе, в кухне, в комнате).
        Use this card before every later floor: the trigger is в or о + the question где? or о чём?
      table:
        caption: "Окончания"
        header: ["род", "ending", "пример"]
        rows:
          - ["m.", "-е", "в банке"]
          - ["n.", "-е", "в кафе"]
          - ["f. -а/-я", "-е", "в школе"]
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s01 }
          highlight: ["городе"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s02 }
          highlight: ["банке"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s03 }
          highlight: ["школе"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s04 }
          highlight: ["улице"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s05 }
          highlight: ["кафе"]
    - id: u1-k1
      kind: check
      items: ["u1-k01"]
    - id: u1-x2
      kind: explain
      title: { ru: "В + предложный: -ия, -ий и местоимения", en: "In + prepositional: -ия, -ий and pronouns" }
      body: |
        Nouns ending in -ия and -ий change to -и, not -е (в Италии, в музее).
        Adjectives agree with the noun, so the ending moves too (в большом городе, в моей комнате).
        Pronouns change as well (в нём, о нём, в ней).
        Check the case first: the form follows the question, not the other way round.
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s06 }
          highlight: ["Москве"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s07 }
          highlight: ["театре"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s08 }
          highlight: ["доме"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s09 }
          highlight: ["работе"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s10 }
          highlight: ["гостинице"]
    - id: u1-k2
      kind: check
      items: ["u1-k02"]
    - id: u1-tr
      kind: traps
      title: { ru: "Ловушки", en: "Traps" }
      pairs:
        - wrong: "Я живу в большой город."
          right: { storyId: u1-ex, sentenceId: u1s01 }
          reason: "the city takes -е after в: в городе, not город"
        - wrong: "Мой брат работает в банк."
          right: { storyId: u1-ex, sentenceId: u1s02 }
          reason: "the bank takes -е after в: в банке"
        - wrong: "Мы говорим о школа."
          right: { storyId: u1-ex, sentenceId: u1s03 }
          reason: "after о the feminine ending is -е: о школе"
    - id: u1-ed
      kind: edge
      title: { ru: "Тонкости", en: "Edge cases" }
      body: |
        Some masculine nouns stress the ending in the prepositional (в лесу, в шкафу) — learn the stressed form as a unit.
        Words like «в году» and «в 2020 году» use the same case for time.
        Do not confuse в + prepositional (where) with в + accusative (direction): the accusative answers куда? (where to?).
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s11 }
          highlight: ["Киеве"]
        - sentenceRef: { storyId: u1-ex, sentenceId: u1s12 }
          highlight: ["парке"]
    - id: u1-lib
      kind: library
      quotes:
        - packId: a1-no-end-house-001
          storyId: part-1
          sentenceId: nea1p1-s04
          highlight: ["колледже"]
          why: "в + где? → предложный"
          text: "Мы дружили в колледже."
        - packId: a1-no-end-house-001
          storyId: part-1
          sentenceId: nea1p1-s08
          highlight: ["квартире"]
          why: "в + где? → предложный (квартира → квартире)"
          text: "После колледжа я жил в маленькой квартире и видел Питера редко."
    exercises:
      size: 4
      pool: ["u1-c01", "u1-c02", "u1-c03", "u1-c04", "u1-t01", "u1-t02", "u1-g01", "u1-g02", "u1-r01", "u1-r02"]
  - id: u2
    title: { ru: "в или на?", en: "в or на?" }
    summary: { en: "In or on/at: the same case, a different preposition." }
    cards:
    - id: u2-x1
      kind: explain
      title: { ru: "На + предложный: поверхность, почта, работа", en: "На + prepositional: surfaces, post office, work" }
      body: |
        Both в and на often translate as "in" or "at", so the choice is a question of the place, not the grammar.
        Use в for an enclosed space or a building you are inside (в школе, в университете, в кино).
        Use на for a surface, a public place, an event or a floor (на почте, на работе, на концерте, на этаже).
        Learn the groups as lexis: на почте, на работе, на вокзале, на уроке, на улице.
      examples:
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s01 }
          highlight: ["почте"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s02 }
          highlight: ["этаже"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s05 }
          highlight: ["вокзале"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s08 }
          highlight: ["работе"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s09 }
          highlight: ["улице"]
    - id: u2-k1
      kind: check
      items: ["u2-k01"]
    - id: u2-x2
      kind: explain
      title: { ru: "В или на: места и события", en: "В or на: places and events" }
      body: |
        The case is the same (prepositional) for both; only the preposition changes.
        Some words only take на: на этаже, на улице, на кухне (the room is treated as a surface here).
        When a place is both an office and a building, the everyday exam answer is на почте, на работе.
        Compare: в школе (inside the building) and на уроке (in class, an event).
      examples:
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s03 }
          highlight: ["школе"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s04 }
          highlight: ["концерте"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s06 }
          highlight: ["университете"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s07 }
          highlight: ["уроке"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s10 }
          highlight: ["кино"]
    - id: u2-k2
      kind: check
      items: ["u2-k02"]
    - id: u2-tr
      kind: traps
      title: { ru: "Ловушки", en: "Traps" }
      pairs:
        - wrong: "Я работаю в почте."
          right: { storyId: u2-ex, sentenceId: u2s01 }
          reason: "почта takes на when it means the post office"
        - wrong: "Я в концерте."
          right: { storyId: u2-ex, sentenceId: u2s04 }
          reason: "an event takes на: на концерте"
        - wrong: "Она в вокзале."
          right: { storyId: u2-ex, sentenceId: u2s05 }
          reason: "вокзал takes на: на вокзале"
    - id: u2-ed
      kind: edge
      title: { ru: "Тонкости", en: "Edge cases" }
      body: |
        The word «работа» takes на: на работе. Its plural is on the same pattern.
        Some pairs differ only by the preposition and the meaning changes: в концерте is not a normal phrase; на концерте is.
        «Почта» takes на when it means the post office: на почте.
      examples:
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s11 }
          highlight: ["почте"]
        - sentenceRef: { storyId: u2-ex, sentenceId: u2s12 }
          highlight: ["кухне"]
    - id: u2-lib
      kind: library
      quotes:
        - packId: a1-no-end-house-001
          storyId: part-2
          sentenceId: nea1p2-s11
          highlight: ["гостинице"]
          why: "в + где? → предложный (гостиница → гостинице)"
          text: "Внутри — обычный холл, как в гостинице, только с украшениями на Хеллоуин."
        - packId: a1-no-end-house-001
          storyId: part-2
          sentenceId: nea1p2-s19
          highlight: ["конце"]
          why: "в + где? → предложный (конец → конце)"
          text: "В конце комнаты — выход."
    exercises:
      size: 4
      pool: ["u2-c01", "u2-c02", "u2-c03", "u2-c04", "u2-t01", "u2-t02", "u2-g01", "u2-g02", "u2-r01", "u2-r02"]
  floorExam:
    size: 5
    pool: ["fe-c01", "fe-c02", "fe-c03", "fe-c04", "fe-c05", "fe-t01", "fe-t02", "fe-g01", "fe-r01", "fe-r02"]
items:
  - id: u1-c01
    topic: case-prep
    kind: choice
    stem: "Я живу в … городе."
    stemEn: "I live in a … city."
    options: [ "большом", "большой", "большого", "большую" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s01 }
  - id: u1-c02
    topic: case-prep
    kind: choice
    stem: "Мой брат работает в …"
    stemEn: "My brother works at a …"
    options: [ "банке", "банк", "банка", "банку" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s02 }
  - id: u1-c03
    topic: case-prep
    kind: choice
    stem: "Мы говорим о …"
    stemEn: "We are talking about …"
    options: [ "школе", "школа", "школу", "школой" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s03 }
  - id: u1-c04
    topic: case-prep
    kind: choice
    stem: "Мы сидим в …"
    stemEn: "We sit in a café."
    options: [ "кафе", "кафо", "кафу", "кафом" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s05 }
  - id: u1-t01
    topic: case-prep
    kind: typed
    prompt: "Я читаю о (Москва)."
    accept: [ "Москве" ]
    half: [ "Москва" ]
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s06 }
  - id: u1-t02
    topic: case-prep
    kind: typed
    prompt: "Он был в (театр) вчера."
    accept: [ "театре" ]
    half: [ "театр" ]
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s07 }
  - id: u1-g01
    topic: case-prep
    kind: trigger
    sentence: "Я читаю о Москве."
    tokens: [ "Я", "читаю", "о", "Москве" ]
    answer: 2
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s06 }
  - id: u1-g02
    topic: case-prep
    kind: trigger
    sentence: "Он был в театре вчера."
    tokens: [ "Он", "был", "в", "театре", "вчера" ]
    answer: 2
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s07 }
  - id: u1-r01
    topic: case-prep
    kind: transform
    prompt: "Это мой брат. → Мы говорим о …"
    accept: [ "брате" ]
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s09 }
  - id: u1-r02
    topic: case-prep
    kind: transform
    prompt: "Это моя комната. → Я думаю о …"
    accept: [ "комнате" ]
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s10 }
  - id: u1-k01
    topic: case-prep
    kind: choice
    stem: "Он живёт в … (Киев)."
    stemEn: "He lives in Kyiv."
    options: [ "Киеве", "Киев", "Киева", "Киеву" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s11 }
  - id: u1-k02
    topic: case-prep
    kind: choice
    stem: "Мы гуляем в …"
    stemEn: "We walk in the …"
    options: [ "парке", "парк", "парку", "парком" ]
    answer: 0
    explain: "Trigger: в + где? (in + where?). Rule: the prepositional case answers где? with в + -е for masculine and neuter nouns, and -е for feminine nouns ending in -а/-я. Why each wrong option is wrong: the nominative or accusative form does not answer где? so it is the wrong case for this place question."
    voiced: { storyId: u1-ex, sentenceId: u1s12 }
  - id: u2-c01
    topic: case-prep
    kind: choice
    stem: "Я работаю … почте."
    stemEn: "I work … the post office."
    options: [ "на", "в", "по", "за" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s01 }
  - id: u2-c02
    topic: case-prep
    kind: choice
    stem: "Мы живём … этаже пять."
    stemEn: "We live … floor five."
    options: [ "на", "в", "по", "за" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s02 }
  - id: u2-c03
    topic: case-prep
    kind: choice
    stem: "Он … концерте."
    stemEn: "He is … the concert."
    options: [ "на", "в", "по", "за" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s04 }
  - id: u2-c04
    topic: case-prep
    kind: choice
    stem: "Я … школе."
    stemEn: "I am … school."
    options: [ "в", "на", "по", "за" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s03 }
  - id: u2-t01
    topic: case-prep
    kind: typed
    prompt: "Она на (вокзал)."
    accept: [ "вокзале" ]
    half: [ "вокзал" ]
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s05 }
  - id: u2-t02
    topic: case-prep
    kind: typed
    prompt: "Я работаю в (почта)."
    accept: [ "почте" ]
    half: [ "почта" ]
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s01 }
  - id: u2-g01
    topic: case-prep
    kind: trigger
    sentence: "Мы в университете."
    tokens: [ "Мы", "в", "университете" ]
    answer: 1
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s06 }
  - id: u2-g02
    topic: case-prep
    kind: trigger
    sentence: "Я на уроке русского."
    tokens: [ "Я", "на", "уроке", "русского" ]
    answer: 1
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s07 }
  - id: u2-r01
    topic: case-prep
    kind: transform
    prompt: "Я работаю в банке. → Я работаю … (почта)."
    accept: [ "на почте" ]
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s08 }
  - id: u2-r02
    topic: case-prep
    kind: transform
    prompt: "Я в школе. → Я … (урок)."
    accept: [ "на уроке" ]
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s09 }
  - id: u2-k01
    topic: case-prep
    kind: choice
    stem: "Мы в … (кухня)."
    stemEn: "We are in the kitchen."
    options: [ "кухне", "кухня", "кухню", "кухней" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s12 }
  - id: u2-k02
    topic: case-prep
    kind: choice
    stem: "Вы … почте?"
    stemEn: "Are you at the post office?"
    options: [ "на", "в", "по", "за" ]
    answer: 0
    explain: "Trigger: на or в with a place noun. Rule: на marks a surface, a public place, a floor or an event; в marks an enclosed space or a building. Why each wrong option is wrong: the other preposition names the wrong kind of place, so the sentence means something else."
    voiced: { storyId: u2-ex, sentenceId: u2s11 }
  - id: fe-c01
    topic: case-prep
    kind: choice
    stem: "Я живу в … городе."
    stemEn: "I live in a … city."
    options: [ "большом", "большой", "большого", "большую" ]
    answer: 0
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s01 }
  - id: fe-c02
    topic: case-prep
    kind: choice
    stem: "Мой брат работает на …"
    stemEn: "My brother works at the …"
    options: [ "почте", "почта", "почту", "почтой" ]
    answer: 0
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s02 }
  - id: fe-c03
    topic: case-prep
    kind: choice
    stem: "Мы говорим о …"
    stemEn: "We are talking about …"
    options: [ "работе", "работа", "работу", "работой" ]
    answer: 0
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s03 }
  - id: fe-c04
    topic: case-prep
    kind: choice
    stem: "Она … школе."
    stemEn: "She is … school."
    options: [ "в", "на" ]
    answer: 0
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s04 }
  - id: fe-c05
    topic: case-prep
    kind: choice
    stem: "Я … уроке."
    stemEn: "I am … class."
    options: [ "на", "в", "по", "за" ]
    answer: 0
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s05 }
  - id: fe-t01
    topic: case-prep
    kind: typed
    prompt: "Он живёт в (дом)."
    accept: [ "доме" ]
    half: [ "дом" ]
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s06 }
  - id: fe-t02
    topic: case-prep
    kind: typed
    prompt: "Мы сидим на (кухня)."
    accept: [ "кухне" ]
    half: [ "кухня" ]
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s07 }
  - id: fe-g01
    topic: case-prep
    kind: trigger
    sentence: "Я думаю о доме."
    tokens: [ "Я", "думаю", "о", "доме" ]
    answer: 2
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s08 }
  - id: fe-r01
    topic: case-prep
    kind: transform
    prompt: "Это моя комната. → Я думаю о … (дом)."
    accept: [ "доме" ]
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s09 }
  - id: fe-r02
    topic: case-prep
    kind: transform
    prompt: "Мы гуляем в … (парк)."
    accept: [ "парке" ]
    explain: "Trigger: в or на with a place or time noun. Rule: the prepositional case takes в for enclosed spaces and на for surfaces, offices, floors and events. Why each wrong option is wrong: the other preposition describes a different kind of place, and the accusative form answers куда? not где?."
    voiced: { storyId: floor-exam, sentenceId: fe01s10 }
---

# a1-hotel-fixture — floor 3 (T88 fixture)
