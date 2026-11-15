---
pack:
  id: a2-hotel-fixture-f01
  version: 1
  type: course
  title: { ru: "Отель «Сумрак»: корпус А2, тестовый этаж 1", en: "Hotel Sumrak: A2 building, fixture floor 1" }
  level: A2
  tags: ["torfl", "torfl:fixture", "hotel"]
course:
  ladder: torfl
  level: A2
  floor: 1
  title: { ru: "Много и многие", en: "Many and much" }
  subtitle: { ru: "Множественное число во всех падежах", en: "The plural in every case" }
  gate:
    passPercent: 80
    extern:
      passPercent: 90
  practice:
    - packId: a2-torfl-lexgram-001
      examId: lg-case-plural
  units:
  - id: u1
    title: { ru: "Родительный множественного", en: "Genitive plural" }
    summary: { en: "After five, много, нет and сколько: -ов, -ей or a zero ending." }
    cards:
    - id: h2f01-u1-c01
      kind: explain
      title: { ru: "Три окончания", en: "Three endings" }
      body: |
        Корпус А1, этаж 6 taught the genitive singular after нет. At A2 the same triggers take the PLURAL: пять, много, нет, сколько.
        Masculine nouns take -ов (студентов, домов); nouns in a soft sign or a hushing consonant take -ей (людей, детей).
        Feminine and neuter nouns usually drop their ending (писем, сестёр), often with a fleeting vowel.
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f01u1-s001 }
          highlight: ["студентов"]
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f01u1-s002 }
          highlight: ["денег"]
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f01u1-s003 }
          highlight: ["людей"]
    - id: h2f01-u1-c02
      kind: check
      items: ["u1-k01"]
    - id: h2f01-u1-c03
      kind: traps
      title: { ru: "Ловушки", en: "Traps" }
      pairs:
        - wrong: "В группе пять студенты."
          right: { storyId: u1-ex, sentenceId: h2f01u1-s001 }
          reason: "after пять the noun is genitive plural: студентов"
        - wrong: "На улице много люди."
          right: { storyId: u1-ex, sentenceId: h2f01u1-s003 }
          reason: "after много the noun is genitive plural: людей"
    - id: h2f01-u1-c04
      kind: edge
      title: { ru: "Тонкости", en: "Edge cases" }
      body: |
        Two, three and four take the genitive SINGULAR (три письма), five and up the genitive plural (пять писем).
        The fleeting vowel appears in the zero ending: письмо → писем, сестра → сестёр, деньги → денег.
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f01u1-s004 }
          highlight: ["письма", "писем"]
    exercises:
      size: 2
      pool: ["u1-c01", "u1-c02", "u1-c03", "u1-c04", "u1-t01", "u1-t02", "u1-g01", "u1-r01"]
  floorExam:
    size: 3
    pool: ["fe-c01", "fe-c02", "fe-c03", "fe-t01", "fe-g01", "fe-r01"]
items:
  - id: u1-c01
    topic: case-plural
    kind: choice
    stem: "В группе пять …"
    stemEn: "There are five … in the group."
    options: [ "студентов", "студенты", "студента", "студентам" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s001 }
  - id: u1-c02
    topic: case-plural
    kind: choice
    stem: "У меня нет …"
    stemEn: "I have no …"
    options: [ "денег", "деньги", "деньгов", "деньгах" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s002 }
  - id: u1-c03
    topic: case-plural
    kind: choice
    stem: "На улице много …"
    stemEn: "There are a lot of … in the street."
    options: [ "людей", "люди", "людях", "человеков" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s003 }
  - id: u1-c04
    topic: case-plural
    kind: choice
    stem: "Я написал пять …"
    stemEn: "I wrote five …"
    options: [ "писем", "письма", "письмов", "письмах" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s004 }
  - id: u1-t01
    topic: case-plural
    kind: typed
    prompt: "В группе пять (студент)."
    accept: [ "студентов" ]
    half: [ "студента" ]
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s001 }
  - id: u1-t02
    topic: case-plural
    kind: typed
    prompt: "На улице много (люди)."
    accept: [ "людей" ]
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s003 }
  - id: u1-g01
    topic: case-plural
    kind: trigger
    sentence: "У меня нет денег."
    tokens: [ "У", "меня", "нет", "денег" ]
    answer: 2
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s002 }
  - id: u1-r01
    topic: case-plural
    kind: transform
    prompt: "Это письма. → Я написал пять …"
    accept: [ "писем" ]
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s004 }
  - id: u1-k01
    topic: case-plural
    kind: choice
    stem: "Сколько у тебя …?"
    stemEn: "How much … do you have?"
    options: [ "денег", "деньги", "деньгами", "деньгам" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: u1-ex, sentenceId: h2f01u1-s002 }
  - id: fe-c01
    topic: case-plural
    kind: choice
    stem: "В городе много старых …"
    stemEn: "There are many old … in the town."
    options: [ "домов", "дома", "домах", "домами" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s001 }
  - id: fe-c02
    topic: case-plural
    kind: choice
    stem: "В городе много … домов."
    stemEn: "There are many … houses in the town."
    options: [ "старых", "старые", "старым", "старыми" ]
    answer: 0
    explain: "Trigger: много + a genitive plural noun. Rule: an adjective agrees with its noun, so after много it takes the genitive plural -ых/-их. Why each wrong option is wrong: старые is nominative, старым dative and старыми instrumental, none of which agrees with домов."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s001 }
  - id: fe-c03
    topic: case-plural
    kind: choice
    stem: "У моих сестёр нет …"
    stemEn: "My sisters have no …"
    options: [ "детей", "дети", "детях", "детьми" ]
    answer: 0
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s002 }
  - id: fe-t01
    topic: case-plural
    kind: typed
    prompt: "У моих (сестра) нет детей."
    accept: [ "сестёр" ]
    half: [ "сестры" ]
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s002 }
  - id: fe-g01
    topic: case-plural
    kind: trigger
    sentence: "В городе много старых домов."
    tokens: [ "В", "городе", "много", "старых", "домов" ]
    answer: 2
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s001 }
  - id: fe-r01
    topic: case-plural
    kind: transform
    prompt: "Это дети. → У моих сестёр нет …"
    accept: [ "детей" ]
    explain: "Trigger: a number from five up, много, нет or сколько. Rule: these words take the genitive plural, and the genitive plural ending depends on the noun: -ов/-ев, -ей, or a zero ending. Why each wrong option is wrong: the other forms are the nominative plural or the genitive singular, which do not follow this trigger."
    voiced: { storyId: floor-exam, sentenceId: h2f01fx-s002 }
---

# a2-hotel-fixture-f01 — A2 building, floor 1 (T116 fixture)
