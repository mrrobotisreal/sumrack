---
pack:
  id: a2-dialogue-001
  version: 1
  type: dialogue
  title: { ru: 'Ужин у мамы', en: "Dinner at Mama's" }
  level: A2
  tags: ['dialogue', 'family']
dialogue:
  id: dinner-mini
  title: { ru: 'Ужин у мамы', en: "Dinner at Mama's" }
  level: A2
  startNodeId: din-n01
characters:
  - id: mama
    name: { ru: 'Мама', en: 'Mama' }
    voice: elevenlabs:Mariia
    style: warm
    audioTag: '[warm]'
  - id: babushka
    name: { ru: 'Бабушка', en: 'Grandmother' }
    voice: elevenlabs:Kate
    style: gentle
    audioTag: '[gentle]'
  - id: player
    name: { ru: 'Ты', en: 'You' }
    voice: elevenlabs:Ivan
    style: neutral
endings:
  - id: end-good
    title: { ru: 'Отличное впечатление', en: 'A great impression' }
    recap:
      {
        ru: 'Ты хорошо поел, похвалил борщ, и бабушка тобой довольна.',
        en: 'You ate well, praised the borscht, and Grandmother is pleased with you.',
      }
    tone: good
  - id: end-awkward
    title: { ru: 'Неловкий вечер', en: 'An awkward evening' }
    recap:
      {
        ru: 'Ты сказал нет — и за столом стало очень тихо.',
        en: 'You said no — and the table went very quiet.',
      }
    tone: bad
  - id: end-strange
    title: { ru: 'Она тоже видит', en: 'She sees it too' }
    recap:
      {
        ru: 'На стене что-то есть, и бабушка это знает.',
        en: 'There is something on the wall, and Grandmother knows it.',
      }
    tone: strange
---

# Ужин у мамы — Dinner at Mama's

## din-n01

SPEAKER: mama

RU: Проходи, дорогой!
EN: Come in, dear!
GRAMMAR: imperative

| text    | lemma     | translation | pos  | grammar                     | level | note |
| ------- | --------- | ----------- | ---- | --------------------------- | ----- | ---- |
| Проходи | проходить | come in     | verb | 2sg. imper. (impf.)         | A2    |      |
| ,       |           |             |      |                             |       |      |
| дорогой | дорогой   | dear        | adj  | m.sg. nom. (as an address)  | A2    |      |
| !       |           |             |      |                             |       |      |

NEXT: din-n02

## din-n02

SPEAKER: mama

RU: Ты голодный?
EN: Are you hungry?
GRAMMAR: adjective-predicate

| text     | lemma    | translation | pos  | grammar    | level | note |
| -------- | -------- | ----------- | ---- | ---------- | ----- | ---- |
| Ты       | ты       | you         | pron | nom. (informal) | A1 |     |
| голодный | голодный | hungry      | adj  | m.sg. nom. | A2    |      |
| ?        |          |             |      |            |       |      |

CHOICES:

### din-n02-c1 -> din-n03

RU: Да, я очень голодный.
EN: Yes, I'm very hungry.

| text     | lemma    | translation | pos  | grammar    | level | note |
| -------- | -------- | ----------- | ---- | ---------- | ----- | ---- |
| Да       | да       | yes         | part |            | A1    |      |
| ,        |          |             |      |            |       |      |
| я        | я        | I           | pron | nom.       | A1    |      |
| очень    | очень    | very        | adv  |            | A1    |      |
| голодный | голодный | hungry      | adj  | m.sg. nom. | A2    |      |
| .        |          |             |      |            |       |      |

ALT: Да, очень.

### din-n02-c2 -> din-n04

RU: Нет, спасибо, я не голодный.
EN: No, thank you, I'm not hungry.

| text     | lemma    | translation | pos    | grammar    | level | note |
| -------- | -------- | ----------- | ------ | ---------- | ----- | ---- |
| Нет      | нет      | no          | part   |            | A1    |      |
| ,        |          |             |        |            |       |      |
| спасибо  | спасибо  | thank you   | interj |            | A1    |      |
| ,        |          |             |        |            |       |      |
| я        | я        | I           | pron   | nom.       | A1    |      |
| не       | не       | not         | part   | negation   | A1    |      |
| голодный | голодный | hungry      | adj    | m.sg. nom. | A2    |      |
| .        |          |             |        |            |       |      |

HINT: Вежливый отказ — но мама не сдастся. | A polite refusal — but Mama won't take no for an answer.

### din-n02-c3 -> din-n09

RU: А что это на стене?
EN: And what is that on the wall?
GRAMMAR: prepositional-location

| text  | lemma | translation | pos  | grammar            | level | note |
| ----- | ----- | ----------- | ---- | ------------------ | ----- | ---- |
| А     | а     | and         | conj |                    | A1    |      |
| что   | что   | what        | pron | nom.               | A1    |      |
| это   | это   | that        | pron | demonstrative      | A1    |      |
| на    | на    | on          | prep | + prep. (location) | A1    |      |
| стене | стена | wall        | noun | f.sg. prep.        | A1    |      |
| ?     |       |             |      |                    |       |      |

## din-n03

SPEAKER: mama

RU: Отлично, я сделала борщ!
EN: Great, I made borscht!
GRAMMAR: past-tense, accusative-direct-object

| text    | lemma   | translation | pos  | grammar                  | level | note                                                  |
| ------- | ------- | ----------- | ---- | ------------------------ | ----- | ----------------------------------------------------- |
| Отлично | отлично | great       | adv  |                          | A2    |                                                       |
| ,       |         |             |      |                          |       |                                                       |
| я       | я       | I           | pron | nom.                     | A1    |                                                       |
| сделала | сделать | made        | verb | f.sg. past (pf. of делать) | A1  |                                                       |
| борщ    | борщ    | borscht     | noun | m.sg. acc.               | A2    | beet soup — the centerpiece of a Russian family table |
| !       |         |             |      |                          |       |                                                       |

NEXT: din-n05

## din-n04

SPEAKER: mama

RU: Ничего, борщ уже на столе.
EN: No matter, the borscht is already on the table.
GRAMMAR: prepositional-location

| text   | lemma  | translation | pos  | grammar                  | level | note                              |
| ------ | ------ | ----------- | ---- | ------------------------ | ----- | --------------------------------- |
| Ничего | ничего | no matter   | pred | colloquial ("it's nothing") | A2 | here = "never mind / no matter"   |
| ,      |        |             |      |                          |       |                                   |
| борщ   | борщ   | borscht     | noun | m.sg. nom.               | A2    |                                   |
| уже    | уже    | already     | adv  |                          | A1    |                                   |
| на     | на     | on          | prep | + prep. (location)       | A1    |                                   |
| столе  | стол   | table       | noun | m.sg. prep.              | A1    |                                   |
| .      |        |             |      |                          |       |                                   |

NEXT: din-n05

## din-n05

SPEAKER: babushka

RU: Наш борщ — самый вкусный.
EN: Our borscht is the tastiest.
GRAMMAR: superlative

| text    | lemma   | translation | pos  | grammar                  | level | note |
| ------- | ------- | ----------- | ---- | ------------------------ | ----- | ---- |
| Наш     | наш     | our         | pron | m.sg. nom.               | A1    |      |
| борщ    | борщ    | borscht     | noun | m.sg. nom.               | A2    |      |
| —       |         |             |      |                          |       |      |
| самый   | самый   | the most    | pron | m.sg. nom. (superlative) | A2    |      |
| вкусный | вкусный | tasty       | adj  | m.sg. nom.               | A1    |      |
| .       |         |             |      |                          |       |      |

NEXT: din-n06

## din-n06

SPEAKER: mama

RU: Хочешь ещё борща?
EN: Do you want more borscht?
GRAMMAR: genitive-partitive

| text   | lemma  | translation | pos  | grammar               | level | note |
| ------ | ------ | ----------- | ---- | --------------------- | ----- | ---- |
| Хочешь | хотеть | you want    | verb | 2sg. pres. (impf.)    | A1    |      |
| ещё    | ещё    | more        | adv  |                       | A1    |      |
| борща  | борщ   | borscht     | noun | m.sg. gen. (partitive) | A2   |      |
| ?      |        |             |      |                       |       |      |

CHOICES:

### din-n06-c1 -> din-n07

RU: Да, можно ещё немного.
EN: Yes, a little more, please.

| text    | lemma   | translation  | pos  | grammar    | level | note |
| ------- | ------- | ------------ | ---- | ---------- | ----- | ---- |
| Да      | да      | yes          | part |            | A1    |      |
| ,       |         |              |      |            |       |      |
| можно   | можно   | one may have | pred | impersonal | A1    |      |
| ещё     | ещё     | more         | adv  |            | A1    |      |
| немного | немного | a little     | adv  |            | A2    |      |
| .       |         |              |      |            |       |      |

ALT: Да, ещё немного, пожалуйста.

### din-n06-c2 -> din-n08

RU: Спасибо, я сыт, всё было очень вкусно.
EN: Thank you, I'm full, everything was very tasty.
GRAMMAR: short-adjectives, past-tense

| text    | lemma   | translation | pos    | grammar            | level | note                                                   |
| ------- | ------- | ----------- | ------ | ------------------ | ----- | ------------------------------------------------------ |
| Спасибо | спасибо | thank you   | interj |                    | A1    |                                                        |
| ,       |         |             |        |                    |       |                                                        |
| я       | я       | I           | pron   | nom.               | A1    |                                                        |
| сыт     | сытый   | full        | adj    | m.sg. short form   | A2    | the short form is the normal way to say "I'm full"     |
| ,       |         |             |        |                    |       |                                                        |
| всё     | весь    | everything  | pron   | n.sg. nom.         | A1    |                                                        |
| было    | быть    | was         | verb   | n.sg. past (impf.) | A1    |                                                        |
| очень   | очень   | very        | adv    |                    | A1    |                                                        |
| вкусно  | вкусно  | tasty       | adv    | predicative        | A1    |                                                        |
| .       |         |             |        |                    |       |                                                        |

ALT: Спасибо, было очень вкусно.
HINT: Скажи спасибо и похвали еду. | Say thank you and praise the food.

### din-n06-c3 -> din-n10

RU: Нет.
EN: No.

| text | lemma | translation | pos  | grammar | level | note |
| ---- | ----- | ----------- | ---- | ------- | ----- | ---- |
| Нет  | нет   | no          | part |         | A1    |      |
| .    |       |             |      |         |       |      |

## din-n07

SPEAKER: mama

RU: Кушай, кушай!
EN: Eat, eat!
GRAMMAR: imperative

| text  | lemma  | translation | pos  | grammar             | level | note                                                        |
| ----- | ------ | ----------- | ---- | ------------------- | ----- | ----------------------------------------------------------- |
| Кушай | кушать | eat         | verb | 2sg. imper. (impf.) | A2    | кушать — homely, affectionate "to eat", beloved by mamas    |
| ,     |        |             |      |                     |       |                                                             |
| кушай | кушать | eat         | verb | 2sg. imper. (impf.) | A2    |                                                             |
| !     |        |             |      |                     |       |                                                             |

NEXT: din-n06

## din-n08

SPEAKER: babushka

RU: Молодец, приходи к нам ещё.
EN: Good boy, come visit us again.
GRAMMAR: imperative, dative-direction

| text    | lemma     | translation | pos  | grammar             | level | note                                  |
| ------- | --------- | ----------- | ---- | ------------------- | ----- | ------------------------------------- |
| Молодец | молодец   | good boy    | noun | m.sg. nom. (praise) | A2    | universal Russian praise — "well done!" |
| ,       |           |             |      |                     |       |                                       |
| приходи | приходить | come        | verb | 2sg. imper. (impf.) | A2    |                                       |
| к       | к         | to          | prep | + dat.              | A1    |                                       |
| нам     | мы        | us          | pron | dat.                | A1    |                                       |
| ещё     | ещё       | again       | adv  |                     | A1    |                                       |
| .       |           |             |      |                     |       |                                       |

ENDING: end-good

## din-n09

SPEAKER: mama

RU: Там ничего нет.
EN: There is nothing there.
GRAMMAR: genitive-negation

| text   | lemma | translation | pos  | grammar                | level | note |
| ------ | ----- | ----------- | ---- | ---------------------- | ----- | ---- |
| Там    | там   | there       | adv  |                        | A1    |      |
| ничего | ничто | nothing     | pron | gen. (object of нет)   | A2    |      |
| нет    | нет   | there is no | pred | + gen. = there is no … | A1    |      |
| .      |       |             |      |                        |       |      |

NEXT: din-n11

## din-n10

SPEAKER: mama

RU: Ну ладно.
EN: Well, alright.

| text  | lemma | translation | pos  | grammar | level | note |
| ----- | ----- | ----------- | ---- | ------- | ----- | ---- |
| Ну    | ну    | well        | part |         | A1    |      |
| ладно | ладно | alright     | part |         | A2    |      |
| .     |       |             |      |         |       |      |

ENDING: end-awkward

## din-n11

SPEAKER: babushka

RU: Она тоже это видит.
EN: She sees it too.
GRAMMAR: accusative-direct-object

| text  | lemma  | translation | pos  | grammar            | level | note |
| ----- | ------ | ----------- | ---- | ------------------ | ----- | ---- |
| Она   | она    | she         | pron | nom.               | A1    |      |
| тоже  | тоже   | too         | adv  |                    | A1    |      |
| это   | это    | it          | pron | acc.               | A1    |      |
| видит | видеть | sees        | verb | 3sg. pres. (impf.) | A1    |      |
| .     |        |             |      |                    |       |      |

ENDING: end-strange
