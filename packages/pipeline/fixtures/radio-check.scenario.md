---
pack:
  id: a1-scenario-fixture
  version: 1
  type: scenario
  title: { ru: 'Проверка связи', en: 'Sound Check' }
  level: A1
  tags: ['scenario', 'fixture', 'radio']
scenario:
  id: radio-a1
  familyId: radio
  title: { ru: 'Проверка связи', en: 'Sound Check' }
  level: A1
  brief:
    {
      ru: 'Короткая проверка связи перед эфиром.',
      en: 'A short sound check before going on air.',
    }
  startTurnId: radio-a1-t01
characters:
  - id: host
    name: { ru: 'Ведущий', en: 'Host' }
    voice: elevenlabs:Maxim
    style: radio-host
    role: host
    portrait:
      placeholder: { kind: man, hue: 25 }
    cues:
      confused: 'Извини, я не совсем понял. Ты можешь повторить?'
      hint: 'Warmer and slower — the host is helping, not testing.'
  - id: player
    name: { ru: 'Вы', en: 'You' }
    voice: elevenlabs:Ivan
    style: neutral
    role: player
scene:
  bed: studio
  layout: center
  accent: '#c26a3a'
endings:
  - id: end-ok
    title: { ru: 'Связь есть', en: 'Connected' }
    recap: { ru: 'Проверка пройдена.', en: 'Sound check passed.' }
    tone: good
---

# Проверка связи — Sound Check

## radio-a1-t01

SPEAKER: host

SAY:

RU: Проверка связи.
EN: Sound check.

| text     | lemma    | translation       | pos  | grammar    | level | note                                                          |
| -------- | -------- | ----------------- | ---- | ---------- | ----- | ------------------------------------------------------------- |
| Проверка | проверка | check             | noun | f.sg. nom. | A2    |                                                               |
| связи    | связь    | of the connection | noun | f.sg. gen. | B1    | проверка связи = "sound check", literally "connection check" |
| .        |          |                   |      |            |       |                                                               |

SAY:

RU: Раз, два, три.
EN: One, two, three.

| text | lemma | translation | pos | grammar                  | level | note |
| ---- | ----- | ----------- | --- | ------------------------ | ----- | ---- |
| Раз  | раз   | one         | num | counting form of «один» | A1    |      |
| ,    |       |             |     |                          |       |      |
| два  | два   | two         | num | nom.                     | A1    |      |
| ,    |       |             |     |                          |       |      |
| три  | три   | three       | num | nom.                     | A1    |      |
| .    |       |             |     |                          |       |      |

SAY:

RU: Вы меня слышите?
EN: Can you hear me?

| text    | lemma   | translation | pos  | grammar            | level | note |
| ------- | ------- | ----------- | ---- | ------------------ | ----- | ---- |
| Вы      | вы      | you         | pron | formal nom.        | A1    |      |
| меня    | я       | me          | pron | acc.               | A1    |      |
| слышите | слышать | hear        | verb | 2pl. pres. (impf.) | A1    |      |
| ?       |         |             |      |                    |       |      |

NEXT: radio-a1-t02

## radio-a1-t02

SPEAKER: host

SAY:

RU: Отлично.
EN: Great.

| text    | lemma   | translation | pos | grammar     | level | note |
| ------- | ------- | ----------- | --- | ----------- | ----- | ---- |
| Отлично | отлично | great       | adv | predicative | A2    |      |
| .       |         |             |     |             |       |      |

SAY:

RU: Как вас зовут?
EN: What's your name?

| text  | lemma | translation | pos  | grammar                                 | level | note                                             |
| ----- | ----- | ----------- | ---- | --------------------------------------- | ----- | ------------------------------------------------ |
| Как   | как   | how         | adv  | interrogative                           | A1    | как вас зовут = literally "how do they call you" |
| вас   | вы    | you         | pron | acc.                                    | A1    |                                                  |
| зовут | звать | (they) call | verb | 3pl. pres. (impf., indefinite-personal) | A1    |                                                  |
| ?     |       |             |      |                                         |       |                                                  |

EXPECT:
  slot name required free minTokens=1
  accept: Меня зовут Митч. | Я Митч.
  reject: хорошо, спасибо -> REACT:

RU: Нет, имя.
EN: No, your name.

| text | lemma | translation | pos  | grammar    | level | note |
| ---- | ----- | ----------- | ---- | ---------- | ----- | ---- |
| Нет  | нет   | no          | part |            | A1    |      |
| ,    |       |             |      |            |       |      |
| имя  | имя   | name        | noun | n.sg. nom. | A1    |      |
| .    |       |             |      |            |       |      |

RETRY:
  CONFUSED:

RU: Не расслышал.
EN: Didn't catch that.

| text      | lemma      | translation           | pos  | grammar           | level | note |
| --------- | ---------- | --------------------- | ---- | ----------------- | ----- | ---- |
| Не        | не         | not                   | part | negation          | A1    |      |
| расслышал | расслышать | caught (heard clearly) | verb | m.sg. past (pf.)  | B1    |      |
| .         |            |                       |      |                   |       |      |

  HINT:

RU: Скажите: «Меня зовут…».
EN: Say: "My name is…".

| text    | lemma   | translation | pos  | grammar            | level | note |
| ------- | ------- | ----------- | ---- | ------------------ | ----- | ---- |
| Скажите | сказать | say         | verb | 2pl. imper. (pf.)  | A1    |      |
| :       |         |             |      |                    |       |      |
| «       |         |             |      |                    |       |      |
| Меня    | я       | me          | pron | acc.               | A1    |      |
| зовут   | звать   | (they) call | verb | 3pl. pres. (impf.) | A1    |      |
| …       |         |             |      |                    |       |      |
| »       |         |             |      |                    |       |      |
| .       |         |             |      |                    |       |      |

  SECOND:

RU: Например: «Меня зовут Митч».
EN: For example: "My name is Mitch."

| text     | lemma    | translation | pos  | grammar            | level | note |
| -------- | -------- | ----------- | ---- | ------------------ | ----- | ---- |
| Например | например | for example | adv  | parenthetical      | A2    |      |
| :        |          |             |      |                    |       |      |
| «        |          |             |      |                    |       |      |
| Меня     | я        | me          | pron | acc.               | A1    |      |
| зовут    | звать    | (they) call | verb | 3pl. pres. (impf.) | A1    |      |
| Митч     | Митч     | Mitch       | name | m. indecl.         |       |      |
| »        |          |             |      |                    |       |      |
| .        |          |             |      |                    |       |      |

  LIFELINE: «Меня зовут …». | "Меня зовут …" (My name is …).

NEXT: radio-a1-t03

## radio-a1-t03

SPEAKER: host

SAY:

RU: Как у вас дела?
EN: How are you?

| text | lemma | translation | pos  | grammar                            | level | note                          |
| ---- | ----- | ----------- | ---- | ---------------------------------- | ----- | ----------------------------- |
| Как  | как   | how         | adv  | interrogative                      | A1    |                               |
| у    | у     | at          | prep | + gen. (у вас = with you / yours) | A1    |                               |
| вас  | вы    | you         | pron | gen.                               | A1    |                               |
| дела | дело  | things      | noun | n.pl. nom.                         | A1    | как дела = "how are things?" |
| ?    |       |             |      |                                    |       |                               |

EXPECT:
  slot mood required forms: good=хорошо: хорошо, отлично, нормально, прекрасно, неплохо | bad=плохо: плохо, устал*, так себе, не очень | ok=ничего: ничего, нормально
  accept: Хорошо, спасибо. | Плохо, я устал. | Ничего.
  branchOn: mood

RETRY:
  CONFUSED:

RU: Как дела? Не понял.
EN: How are you? Didn't get it.

| text  | lemma  | translation | pos  | grammar                      | level | note |
| ----- | ------ | ----------- | ---- | ---------------------------- | ----- | ---- |
| Как   | как    | how         | adv  | interrogative                | A1    |      |
| дела  | дело   | things      | noun | n.pl. nom.                   | A1    |      |
| ?     |        |             |      |                              |       |      |
| Не    | не     | not         | part | negation                     | A1    |      |
| понял | понять | understood  | verb | m.sg. past (pf. of понимать) | A1    |      |
| .     |        |             |      |                              |       |      |

  HINT:

RU: Скажите «хорошо» или «плохо».
EN: Say "good" or "bad".

| text    | lemma   | translation | pos  | grammar           | level | note |
| ------- | ------- | ----------- | ---- | ----------------- | ----- | ---- |
| Скажите | сказать | say         | verb | 2pl. imper. (pf.) | A1    |      |
| «       |         |             |      |                   |       |      |
| хорошо  | хорошо  | good        | adv  | predicative       | A1    |      |
| »       |         |             |      |                   |       |      |
| или     | или     | or          | conj |                   | A1    |      |
| «       |         |             |      |                   |       |      |
| плохо   | плохо   | bad         | adv  | predicative       | A1    |      |
| »       |         |             |      |                   |       |      |
| .       |         |             |      |                   |       |      |

  LIFELINE: «Хорошо, спасибо» / «Плохо, я устал». | "Хорошо, спасибо" (Good, thanks) / "Плохо, я устал" (Bad, I'm tired).

NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d

## radio-a1-t04g

SPEAKER: host

SAY:

RU: Рад слышать.
EN: Glad to hear it.

| text    | lemma   | translation | pos  | grammar          | level | note |
| ------- | ------- | ----------- | ---- | ---------------- | ----- | ---- |
| Рад     | рад     | glad        | adj  | m.sg. short form | A1    |      |
| слышать | слышать | to hear     | verb | inf. (impf.)     | A1    |      |
| .       |         |             |      |                  |       |      |

SAY:

RU: Связь есть.
EN: We have a connection.

| text  | lemma | translation | pos  | grammar     | level | note |
| ----- | ----- | ----------- | ---- | ----------- | ----- | ---- |
| Связь | связь | connection  | noun | f.sg. nom.  | B1    |      |
| есть  | есть  | there is    | pred | existential | A1    |      |
| .     |       |             |      |             |       |      |

SAY:

RU: До эфира!
EN: See you on air!

| text  | lemma | translation     | pos  | grammar    | level | note                                                    |
| ----- | ----- | --------------- | ---- | ---------- | ----- | ------------------------------------------------------- |
| До    | до    | until           | prep | + gen.     | A1    | до эфира = "until we're on air" — a broadcaster's goodbye |
| эфира | эфир  | air (broadcast) | noun | m.sg. gen. | B1    |                                                         |
| !     |       |                 |      |            |       |                                                         |

ENDING: end-ok

## radio-a1-t04b

SPEAKER: host

SAY:

RU: Понимаю.
EN: I understand.

| text     | lemma    | translation    | pos  | grammar            | level | note |
| -------- | -------- | -------------- | ---- | ------------------ | ----- | ---- |
| Понимаю  | понимать | (I) understand | verb | 1sg. pres. (impf.) | A1    |      |
| .        |          |                |      |                    |       |      |

SAY:

RU: Отдохните.
EN: Get some rest.

| text      | lemma     | translation | pos  | grammar           | level | note |
| --------- | --------- | ----------- | ---- | ----------------- | ----- | ---- |
| Отдохните | отдохнуть | rest        | verb | 2pl. imper. (pf.) | A2    |      |
| .         |           |             |      |                   |       |      |

SAY:

RU: Связь есть, до эфира!
EN: We have a connection, see you on air!

| text  | lemma | translation     | pos  | grammar     | level | note |
| ----- | ----- | --------------- | ---- | ----------- | ----- | ---- |
| Связь | связь | connection      | noun | f.sg. nom.  | B1    |      |
| есть  | есть  | there is        | pred | existential | A1    |      |
| ,     |       |                 |      |             |       |      |
| до    | до    | until           | prep | + gen.      | A1    |      |
| эфира | эфир  | air (broadcast) | noun | m.sg. gen.  | B1    |      |
| !     |       |                 |      |             |       |      |

ENDING: end-ok

## radio-a1-t04d

SPEAKER: host

SAY:

RU: Ясно.
EN: I see.

| text | lemma | translation   | pos | grammar     | level | note |
| ---- | ----- | ------------- | --- | ----------- | ----- | ---- |
| Ясно | ясно  | clear (I see) | adv | predicative | A2    |      |
| .    |       |               |     |             |       |      |

SAY:

RU: Связь есть.
EN: We have a connection.

| text  | lemma | translation | pos  | grammar     | level | note |
| ----- | ----- | ----------- | ---- | ----------- | ----- | ---- |
| Связь | связь | connection  | noun | f.sg. nom.  | B1    |      |
| есть  | есть  | there is    | pred | existential | A1    |      |
| .     |       |             |      |             |       |      |

SAY:

RU: До эфира!
EN: See you on air!

| text  | lemma | translation     | pos  | grammar    | level | note |
| ----- | ----- | --------------- | ---- | ---------- | ----- | ---- |
| До    | до    | until           | prep | + gen.     | A1    |      |
| эфира | эфир  | air (broadcast) | noun | m.sg. gen. | B1    |      |
| !     |       |                 |      |            |       |      |

ENDING: end-ok

## glossary

### проверка | check | forms: проверка, проверк* | translit: чек

EXPLAIN:

RU: Проверка — это check.
EN: «Проверка» means check.

| text     | lemma    | translation | pos     | grammar                       | level | note |
| -------- | -------- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Проверка | проверка | check       | noun    | f.sg. nom.                    | A2    |      |
| —        |          |             |         |                               |       |      |
| это      | это      | is          | pron    | demonstrative (gloss marker) | A1    |      |
| check    | check    | check       | foreign | English                       |       |      |
| .        |          |             |         |                               |       |      |

HOWTOSAY:

RU: Check — по-русски «проверка».
EN: Check is «проверка» in Russian.

| text      | lemma     | translation | pos     | grammar    | level | note |
| --------- | --------- | ----------- | ------- | ---------- | ----- | ---- |
| Check     | check     | check       | foreign | English    |       |      |
| —         |           |             |         |            |       |      |
| по-русски | по-русски | in Russian  | adv     |            | A1    |      |
| «         |           |             |         |            |       |      |
| проверка  | проверка  | check       | noun    | f.sg. nom. | A2    |      |
| »         |           |             |         |            |       |      |
| .         |           |             |         |            |       |      |

### связь | connection | forms: связь, связи, связ* | translit: конекшн, канекшен

EXPLAIN:

RU: Связь — это connection.
EN: «Связь» means connection.

| text       | lemma      | translation | pos     | grammar                       | level | note |
| ---------- | ---------- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Связь      | связь      | connection  | noun    | f.sg. nom.                    | B1    |      |
| —          |            |             |         |                               |       |      |
| это        | это        | is          | pron    | demonstrative (gloss marker) | A1    |      |
| connection | connection | connection  | foreign | English                       |       |      |
| .          |            |             |         |                               |       |      |

HOWTOSAY:

RU: Connection — по-русски «связь».
EN: Connection is «связь» in Russian.

| text       | lemma      | translation | pos     | grammar    | level | note |
| ---------- | ---------- | ----------- | ------- | ---------- | ----- | ---- |
| Connection | connection | connection  | foreign | English    |       |      |
| —          |            |             |         |            |       |      |
| по-русски  | по-русски  | in Russian  | adv     |            | A1    |      |
| «          |            |             |         |            |       |      |
| связь      | связь      | connection  | noun    | f.sg. nom. | B1    |      |
| »          |            |             |         |            |       |      |
| .          |            |             |         |            |       |      |

### слышать | to hear | forms: слышать, слыш*, расслыш* | translit: хир

EXPLAIN:

RU: Слышать — это to hear.
EN: «Слышать» means to hear.

| text    | lemma   | translation | pos     | grammar                       | level | note |
| ------- | ------- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Слышать | слышать | to hear     | verb    | inf. (impf.)                  | A1    |      |
| —       |         |             |         |                               |       |      |
| это     | это     | is          | pron    | demonstrative (gloss marker) | A1    |      |
| to      | to      | to          | foreign | English                       |       |      |
| hear    | hear    | hear        | foreign | English                       |       |      |
| .       |         |             |         |                               |       |      |

HOWTOSAY:

RU: To hear — по-русски «слышать».
EN: To hear is «слышать» in Russian.

| text      | lemma     | translation | pos     | grammar      | level | note |
| --------- | --------- | ----------- | ------- | ------------ | ----- | ---- |
| To        | to        | to          | foreign | English      |       |      |
| hear      | hear      | hear        | foreign | English      |       |      |
| —         |           |             |         |              |       |      |
| по-русски | по-русски | in Russian  | adv     |              | A1    |      |
| «         |           |             |         |              |       |      |
| слышать   | слышать   | to hear     | verb    | inf. (impf.) | A1    |      |
| »         |           |             |         |              |       |      |
| .         |           |             |         |              |       |      |

### зовут | name | forms: зовут, звать, имя | translit: нэйм

EXPLAIN:

RU: Зовут — это name.
EN: «Зовут» means name (as in "my name is").

| text  | lemma | translation | pos     | grammar                       | level | note                                        |
| ----- | ----- | ----------- | ------- | ----------------------------- | ----- | ------------------------------------------- |
| Зовут | звать | (they) call | verb    | 3pl. pres. (impf.)            | A1    | меня зовут = "my name is" (they call me …) |
| —     |       |             |         |                               |       |                                             |
| это   | это   | is          | pron    | demonstrative (gloss marker) | A1    |                                             |
| name  | name  | name        | foreign | English                       |       |                                             |
| .     |       |             |         |                               |       |                                             |

HOWTOSAY:

RU: Name — по-русски «зовут»: «Меня зовут…».
EN: Name is «зовут» in Russian: "Меня зовут…".

| text      | lemma     | translation | pos     | grammar            | level | note |
| --------- | --------- | ----------- | ------- | ------------------ | ----- | ---- |
| Name      | name      | name        | foreign | English            |       |      |
| —         |           |             |         |                    |       |      |
| по-русски | по-русски | in Russian  | adv     |                    | A1    |      |
| «         |           |             |         |                    |       |      |
| зовут     | звать     | (they) call | verb    | 3pl. pres. (impf.) | A1    |      |
| »         |           |             |         |                    |       |      |
| :         |           |             |         |                    |       |      |
| «         |           |             |         |                    |       |      |
| Меня      | я         | me          | pron    | acc.               | A1    |      |
| зовут     | звать     | (they) call | verb    | 3pl. pres. (impf.) | A1    |      |
| …         |           |             |         |                    |       |      |
| »         |           |             |         |                    |       |      |
| .         |           |             |         |                    |       |      |

### дела | things | forms: дела, дело | translit: сингз, тингс

EXPLAIN:

RU: Дела — это things.
EN: «Дела» means things (how are things?).

| text   | lemma  | translation | pos     | grammar                       | level | note |
| ------ | ------ | ----------- | ------- | ----------------------------- | ----- | ---- |
| Дела   | дело   | things      | noun    | n.pl. nom.                    | A1    |      |
| —      |        |             |         |                               |       |      |
| это    | это    | is          | pron    | demonstrative (gloss marker) | A1    |      |
| things | things | things      | foreign | English                       |       |      |
| .      |        |             |         |                               |       |      |

HOWTOSAY:

RU: Things — по-русски «дела».
EN: Things is «дела» in Russian.

| text      | lemma     | translation | pos     | grammar    | level | note |
| --------- | --------- | ----------- | ------- | ---------- | ----- | ---- |
| Things    | things    | things      | foreign | English    |       |      |
| —         |           |             |         |            |       |      |
| по-русски | по-русски | in Russian  | adv     |            | A1    |      |
| «         |           |             |         |            |       |      |
| дела      | дело      | things      | noun    | n.pl. nom. | A1    |      |
| »         |           |             |         |            |       |      |
| .         |           |             |         |            |       |      |

### хорошо | good | forms: хорошо, хорош* | translit: гуд

EXPLAIN:

RU: Хорошо — это good.
EN: «Хорошо» means good.

| text   | lemma  | translation | pos     | grammar                       | level | note |
| ------ | ------ | ----------- | ------- | ----------------------------- | ----- | ---- |
| Хорошо | хорошо | good        | adv     | predicative                   | A1    |      |
| —      |        |             |         |                               |       |      |
| это    | это    | is          | pron    | demonstrative (gloss marker) | A1    |      |
| good   | good   | good        | foreign | English                       |       |      |
| .      |        |             |         |                               |       |      |

HOWTOSAY:

RU: Good — по-русски «хорошо».
EN: Good is «хорошо» in Russian.

| text      | lemma     | translation | pos     | grammar     | level | note |
| --------- | --------- | ----------- | ------- | ----------- | ----- | ---- |
| Good      | good      | good        | foreign | English     |       |      |
| —         |           |             |         |             |       |      |
| по-русски | по-русски | in Russian  | adv     |             | A1    |      |
| «         |           |             |         |             |       |      |
| хорошо    | хорошо    | good        | adv     | predicative | A1    |      |
| »         |           |             |         |             |       |      |
| .         |           |             |         |             |       |      |

### рад | glad | forms: рад, рада, рады | translit: глэд, глад

EXPLAIN:

RU: Рад — это glad.
EN: «Рад» means glad.

| text | lemma | translation | pos     | grammar                       | level | note |
| ---- | ----- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Рад  | рад   | glad        | adj     | m.sg. short form              | A1    |      |
| —    |       |             |         |                               |       |      |
| это  | это   | is          | pron    | demonstrative (gloss marker) | A1    |      |
| glad | glad  | glad        | foreign | English                       |       |      |
| .    |       |             |         |                               |       |      |

HOWTOSAY:

RU: Glad — по-русски «рад».
EN: Glad is «рад» in Russian.

| text      | lemma     | translation | pos     | grammar          | level | note |
| --------- | --------- | ----------- | ------- | ---------------- | ----- | ---- |
| Glad      | glad      | glad        | foreign | English          |       |      |
| —         |           |             |         |                  |       |      |
| по-русски | по-русски | in Russian  | adv     |                  | A1    |      |
| «         |           |             |         |                  |       |      |
| рад       | рад       | glad        | adj     | m.sg. short form | A1    |      |
| »         |           |             |         |                  |       |      |
| .         |           |             |         |                  |       |      |

### понимать | to understand | forms: понимать, понима*, поня* | translit: андерстэнд, андэстэнд

EXPLAIN:

RU: Понимать — это to understand.
EN: «Понимать» means to understand.

| text       | lemma      | translation   | pos     | grammar                       | level | note |
| ---------- | ---------- | ------------- | ------- | ----------------------------- | ----- | ---- |
| Понимать   | понимать   | to understand | verb    | inf. (impf.)                  | A1    |      |
| —          |            |               |         |                               |       |      |
| это        | это        | is            | pron    | demonstrative (gloss marker) | A1    |      |
| to         | to         | to            | foreign | English                       |       |      |
| understand | understand | understand    | foreign | English                       |       |      |
| .          |            |               |         |                               |       |      |

HOWTOSAY:

RU: To understand — по-русски «понимать».
EN: To understand is «понимать» in Russian.

| text       | lemma      | translation   | pos     | grammar      | level | note |
| ---------- | ---------- | ------------- | ------- | ------------ | ----- | ---- |
| To         | to         | to            | foreign | English      |       |      |
| understand | understand | understand    | foreign | English      |       |      |
| —          |            |               |         |              |       |      |
| по-русски  | по-русски  | in Russian    | adv     |              | A1    |      |
| «          |            |               |         |              |       |      |
| понимать   | понимать   | to understand | verb    | inf. (impf.) | A1    |      |
| »          |            |               |         |              |       |      |
| .          |            |               |         |              |       |      |

### отдохнуть | to rest | forms: отдохнуть, отдохн*, отдыха* | translit: рест

EXPLAIN:

RU: Отдохнуть — это to rest.
EN: «Отдохнуть» means to rest.

| text      | lemma     | translation | pos     | grammar                       | level | note |
| --------- | --------- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Отдохнуть | отдохнуть | to rest     | verb    | inf. (pf.)                    | A2    |      |
| —         |           |             |         |                               |       |      |
| это       | это       | is          | pron    | demonstrative (gloss marker) | A1    |      |
| to        | to        | to          | foreign | English                       |       |      |
| rest      | rest      | rest        | foreign | English                       |       |      |
| .         |           |             |         |                               |       |      |

HOWTOSAY:

RU: To rest — по-русски «отдохнуть».
EN: To rest is «отдохнуть» in Russian.

| text      | lemma     | translation | pos     | grammar    | level | note |
| --------- | --------- | ----------- | ------- | ---------- | ----- | ---- |
| To        | to        | to          | foreign | English    |       |      |
| rest      | rest      | rest        | foreign | English    |       |      |
| —         |           |             |         |            |       |      |
| по-русски | по-русски | in Russian  | adv     |            | A1    |      |
| «         |           |             |         |            |       |      |
| отдохнуть | отдохнуть | to rest     | verb    | inf. (pf.) | A2    |      |
| »         |           |             |         |            |       |      |
| .         |           |             |         |            |       |      |

### ясно | clear | forms: ясно, ясн* | translit: клир, клиа

EXPLAIN:

RU: Ясно — это clear.
EN: «Ясно» means clear (as in "I see").

| text  | lemma | translation | pos     | grammar                       | level | note |
| ----- | ----- | ----------- | ------- | ----------------------------- | ----- | ---- |
| Ясно  | ясно  | clear       | adv     | predicative                   | A2    |      |
| —     |       |             |         |                               |       |      |
| это   | это   | is          | pron    | demonstrative (gloss marker) | A1    |      |
| clear | clear | clear       | foreign | English                       |       |      |
| .     |       |             |         |                               |       |      |

HOWTOSAY:

RU: Clear — по-русски «ясно».
EN: Clear is «ясно» in Russian.

| text      | lemma     | translation | pos     | grammar     | level | note |
| --------- | --------- | ----------- | ------- | ----------- | ----- | ---- |
| Clear     | clear     | clear       | foreign | English     |       |      |
| —         |           |             |         |             |       |      |
| по-русски | по-русски | in Russian  | adv     |             | A1    |      |
| «         |           |             |         |             |       |      |
| ясно      | ясно      | clear       | adv     | predicative | A2    |      |
| »         |           |             |         |             |       |      |
| .         |           |             |         |             |       |      |

### сказать | to say | forms: сказать, скажи*, сказ* | translit: сэй, сей

EXPLAIN:

RU: Сказать — это to say.
EN: «Сказать» means to say.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Сказать | сказать | to say | verb | inf. (pf.) | A1 |  |
| — |  |  |  |  |  |  |
| это | это | is | pron | demonstrative (gloss marker) | A1 |  |
| to | to | to | foreign | English |  |  |
| say | say | say | foreign | English |  |  |
| . |  |  |  |  |  |  |

HOWTOSAY:

RU: To say — по-русски «сказать».
EN: To say is «сказать» in Russian.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| To | to | to | foreign | English |  |  |
| say | say | say | foreign | English |  |  |
| — |  |  |  |  |  |  |
| по-русски | по-русски | in Russian | adv |  | A1 |  |
| « |  |  |  |  |  |  |
| сказать | сказать | to say | verb | inf. (pf.) | A1 |  |
| » |  |  |  |  |  |  |
| . |  |  |  |  |  |  |

### например | for example | forms: например | translit: фор экзампл, экзампл

EXPLAIN:

RU: Например — это for example.
EN: «Например» means for example.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Например | например | for example | adv | parenthetical | A2 |  |
| — |  |  |  |  |  |  |
| это | это | is | pron | demonstrative (gloss marker) | A1 |  |
| for | for | for | foreign | English |  |  |
| example | example | example | foreign | English |  |  |
| . |  |  |  |  |  |  |

HOWTOSAY:

RU: For example — по-русски «например».
EN: For example is «например» in Russian.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| For | for | for | foreign | English |  |  |
| example | example | example | foreign | English |  |  |
| — |  |  |  |  |  |  |
| по-русски | по-русски | in Russian | adv |  | A1 |  |
| « |  |  |  |  |  |  |
| например | например | for example | adv | parenthetical | A2 |  |
| » |  |  |  |  |  |  |
| . |  |  |  |  |  |  |

### слово | word | forms: слово, слова, слов* | translit: уорд, ворд

EXPLAIN:

RU: Слово — это word.
EN: «Слово» means word.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Слово | слово | word | noun | n.sg. nom. | A1 |  |
| — |  |  |  |  |  |  |
| это | это | is | pron | demonstrative (gloss marker) | A1 |  |
| word | word | word | foreign | English |  |  |
| . |  |  |  |  |  |  |

HOWTOSAY:

RU: Word — по-русски «слово».
EN: Word is «слово» in Russian.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Word | word | word | foreign | English |  |  |
| — |  |  |  |  |  |  |
| по-русски | по-русски | in Russian | adv |  | A1 |  |
| « |  |  |  |  |  |  |
| слово | слово | word | noun | n.sg. nom. | A1 |  |
| » |  |  |  |  |  |  |
| . |  |  |  |  |  |  |

### знать | to know | forms: знать, зна* | translit: ноу

EXPLAIN:

RU: Знать — это to know.
EN: «Знать» means to know.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Знать | знать | to know | verb | inf. (impf.) | A1 |  |
| — |  |  |  |  |  |  |
| это | это | is | pron | demonstrative (gloss marker) | A1 |  |
| to | to | to | foreign | English |  |  |
| know | know | know | foreign | English |  |  |
| . |  |  |  |  |  |  |

HOWTOSAY:

RU: To know — по-русски «знать».
EN: To know is «знать» in Russian.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| To | to | to | foreign | English |  |  |
| know | know | know | foreign | English |  |  |
| — |  |  |  |  |  |  |
| по-русски | по-русски | in Russian | adv |  | A1 |  |
| « |  |  |  |  |  |  |
| знать | знать | to know | verb | inf. (impf.) | A1 |  |
| » |  |  |  |  |  |  |
| . |  |  |  |  |  |  |

### плохо | bad | forms: плохо, плох* | translit: бэд, бад

EXPLAIN:

RU: Плохо — это bad.
EN: «Плохо» means bad.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Плохо | плохо | bad | adv | predicative | A1 |  |
| — |  |  |  |  |  |  |
| это | это | is | pron | demonstrative (gloss marker) | A1 |  |
| bad | bad | bad | foreign | English |  |  |
| . |  |  |  |  |  |  |

HOWTOSAY:

RU: Bad — по-русски «плохо».
EN: Bad is «плохо» in Russian.

| text | lemma | translation | pos | grammar | level | note |
| --- | --- | --- | --- | --- | --- | --- |
| Bad | bad | bad | foreign | English |  |  |
| — |  |  |  |  |  |  |
| по-русски | по-русски | in Russian | adv |  | A1 |  |
| « |  |  |  |  |  |  |
| плохо | плохо | bad | adv | predicative | A1 |  |
| » |  |  |  |  |  |  |
| . |  |  |  |  |  |  |

## nudges

### silence

RU: Вы там?
EN: Are you there?

| text | lemma | translation | pos  | grammar     | level | note |
| ---- | ----- | ----------- | ---- | ----------- | ----- | ---- |
| Вы   | вы    | you         | pron | formal nom. | A1    |      |
| там  | там   | there       | adv  |             | A1    |      |
| ?    |       |             |      |             |       |      |

### which-word

RU: Какое слово?
EN: Which word?

| text  | lemma | translation | pos  | grammar                     | level | note |
| ----- | ----- | ----------- | ---- | --------------------------- | ----- | ---- |
| Какое | какой | which       | pron | n.sg. nom. (interrogative) | A1    |      |
| слово | слово | word        | noun | n.sg. nom.                  | A1    |      |
| ?     |       |             |      |                             |       |      |

### dont-know

RU: Не знаю этого слова.
EN: I don't know that word.

| text  | lemma | translation | pos  | grammar                            | level | note |
| ----- | ----- | ----------- | ---- | ---------------------------------- | ----- | ---- |
| Не    | не    | not         | part | negation                           | A1    |      |
| знаю  | знать | know        | verb | 1sg. pres. (impf.)                 | A1    |      |
| этого | этот  | that        | pron | n.sg. gen.                         | A1    |      |
| слова | слово | word        | noun | n.sg. gen. (object of negated verb) | A1    |      |
| .     |       |             |      |                                    |       |      |
