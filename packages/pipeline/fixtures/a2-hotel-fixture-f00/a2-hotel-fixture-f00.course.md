---
pack:
  id: a2-hotel-fixture-f00
  version: 1
  type: course
  title: { ru: "Отель «Сумрак»: корпус А2, тестовый вестибюль", en: "Hotel Sumrak: A2 building, fixture lobby" }
  level: A2
  tags: ["torfl", "torfl:fixture", "hotel"]
course:
  ladder: torfl
  level: A2
  floor: 0
  title: { ru: "Вестибюль · корпус А2", en: "The lobby · A2 building" }
  subtitle: { ru: "Экзамен ТБУ", en: "The A2 exam" }
  gate:
    passPercent: 80
    extern:
      passPercent: 90
  practice: []
  units:
  - id: u1
    title: { ru: "Экзамен ТБУ (А2) и корпус А2", en: "The A2 exam and the A2 building" }
    summary: { en: "Five subtests, the 66/60 rule, and what is new against A1." }
    cards:
    - id: h2f00-u1-c01
      kind: explain
      title: { ru: "Пять субтестов", en: "Five subtests" }
      body: |
        The A2 exam (ТБУ, базовый уровень) has the same five subtests as A1: lexis and grammar, reading, listening, writing and speaking.
        Each subtest is scored on its own; the SPbU rule asks for at least 66 % in every subtest, and one subtest may sit at 60 %.
        This fixture lobby is a test floor: it carries one unit and no floor exam, exactly like the real Вестибюль.
      examples:
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f00u1-s001 }
          highlight: ["субтестов"]
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f00u1-s002 }
          highlight: ["пятьдесят"]
        - sentenceRef: { storyId: u1-ex, sentenceId: h2f00u1-s003 }
          highlight: ["шестьдесят", "шесть"]
    - id: h2f00-u1-c02
      kind: check
      items: ["u1-k01"]
    exercises:
      size: 2
      pool: ["u1-c01", "u1-c02", "u1-c03", "u1-c04", "u1-c05", "u1-c06", "u1-t01", "u1-t02"]
items:
  - id: u1-c01
    topic: lex-phrases
    kind: choice
    stem: "Экзамен состоит из … субтестов."
    stemEn: "The exam consists of … subtests."
    options: [ "пяти", "пять", "пятью", "пятеро" ]
    answer: 0
    explain: "Trigger: из + a number. Rule: the preposition из takes the genitive, and a number after it takes the genitive too (из пяти). Why each wrong option is wrong: пять is the nominative or accusative, пятью is the instrumental, and пятеро is a collective numeral for people."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s001 }
  - id: u1-c02
    topic: lex-phrases
    kind: choice
    stem: "Сколько субтестов в экзамене А2?"
    stemEn: "How many subtests are there in the A2 exam?"
    options: [ "пять", "четыре", "шесть", "три" ]
    answer: 0
    explain: "Trigger: the format of the exam. Rule: the A2 exam, like A1, has five subtests: lexis and grammar, reading, listening, writing and speaking. Why each wrong option is wrong: four, six and three do not match the official SPbU format of the ТБУ exam."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s001 }
  - id: u1-c03
    topic: lex-phrases
    kind: choice
    stem: "На письмо у вас есть … минут."
    stemEn: "You have … minutes for the writing."
    options: [ "пятьдесят", "двадцать", "сто", "десять" ]
    answer: 0
    explain: "Trigger: the writing subtest. Rule: the A2 writing subtest has two tasks and fifty minutes in all. Why each wrong option is wrong: twenty and ten minutes are too short for the two tasks, and one hundred minutes is not the official time for the writing."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s002 }
  - id: u1-c04
    topic: lex-phrases
    kind: choice
    stem: "Каждый субтест нужно сдать на … процентов."
    stemEn: "Each subtest must be passed at … per cent."
    options: [ "шестьдесят шесть", "пятьдесят", "восемьдесят", "сорок" ]
    answer: 0
    explain: "Trigger: the SPbU pass rule. Rule: every subtest needs at least 66 %, and one subtest may be between 60 and 66 %. Why each wrong option is wrong: fifty and forty are below the line, and eighty is the hotel's own unit gate, not the exam rule."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s003 }
  - id: u1-c05
    topic: lex-phrases
    kind: choice
    stem: "Один субтест может быть на … процентов."
    stemEn: "One subtest may be at … per cent."
    options: [ "шестьдесят", "тридцать", "двадцать", "десять" ]
    answer: 0
    explain: "Trigger: the one borderline subtest. Rule: under the SPbU rule exactly one subtest may fall between 60 and 66 % and the exam still counts as passed. Why each wrong option is wrong: thirty, twenty and ten per cent fail that subtest outright."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s003 }
  - id: u1-c06
    topic: lex-phrases
    kind: choice
    stem: "Экзамен … из пяти субтестов."
    stemEn: "The exam … of five subtests."
    options: [ "состоит", "стоит", "состоят", "стоят" ]
    answer: 0
    explain: "Trigger: состоять из + genitive. Rule: «состоять из» means to consist of, and with one exam the verb is singular: состоит. Why each wrong option is wrong: стоит means costs or stands, and the plural forms do not agree with the singular subject экзамен."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s001 }
  - id: u1-t01
    topic: lex-phrases
    kind: typed
    prompt: "Экзамен состоит из (пять) субтестов."
    accept: [ "пяти" ]
    half: [ "пять" ]
    explain: "Trigger: из + a number. Rule: из takes the genitive, so the number five becomes пяти. Why the other forms are wrong: the nominative пять does not follow из, and the instrumental пятью answers a different question."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s001 }
  - id: u1-t02
    topic: lex-phrases
    kind: typed
    prompt: "Каждый субтест нужно (сдавать / сдать) на шестьдесят шесть процентов."
    accept: [ "сдать" ]
    half: [ "сдавать" ]
    explain: "Trigger: нужно + one concrete result. Rule: a single concrete result after нужно takes the perfective infinitive: сдать. Why the other form is weaker: сдавать names the process of taking exams, not passing this one."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s003 }
  - id: u1-k01
    topic: lex-phrases
    kind: choice
    stem: "Сколько минут на письмо?"
    stemEn: "How many minutes for the writing?"
    options: [ "пятьдесят", "двадцать", "сто", "пять" ]
    answer: 0
    explain: "Trigger: the writing subtest. Rule: the A2 writing subtest has two tasks and fifty minutes in all. Why each wrong option is wrong: twenty and five minutes are too short for two tasks, and one hundred minutes is not the official time."
    voiced: { storyId: u1-ex, sentenceId: h2f00u1-s002 }
---

# a2-hotel-fixture-f00 — A2 building, floor 0 (T116 fixture)
