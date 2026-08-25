---
pack:
  id: broken-dlg-001
  version: 1
  type: dialogue
  title: { ru: 'Тест', en: 'Test' }
  level: A1
  tags: ['test']
dialogue:
  id: broken-dlg
  title: { ru: 'Тест', en: 'Test' }
  level: A1
characters:
  - id: mama
    name: { ru: 'Мама', en: 'Mama' }
    voice: elevenlabs:Mariia
    style: warm
endings:
  - id: end-x
    title: { ru: 'Конец', en: 'End' }
    recap: { ru: 'Всё.', en: 'Done.' }
    tone: good
---

## bd-n1

SPEAKER: mama

RU: Привет.
EN: Hello.

| text   | lemma  | translation | pos    | grammar | level | note |
| ------ | ------ | ----------- | ------ | ------- | ----- | ---- |
| Привет | привет | hello       | interj |         | A1    |      |
| .      |        |             |        |         |       |      |

NEXT: bd-n2

## bd-n2

SPEAKER: mama

RU: Пока.
EN: Bye.

| text | lemma | translation | pos    | grammar | level | note |
| ---- | ----- | ----------- | ------ | ------- | ----- | ---- |
| Пока | пока  | bye         | interj |         | A1    |      |
| .    |       |             |        |         |       |      |

ENDING: end-x

## bd-orphan

SPEAKER: mama

RU: Никто.
EN: Nobody.

| text  | lemma | translation | pos  | grammar | level | note |
| ----- | ----- | ----------- | ---- | ------- | ----- | ---- |
| Никто | никто | nobody      | pron | nom.    | A1    |      |
| .     |       |             |      |         |       |      |

ENDING: end-x
