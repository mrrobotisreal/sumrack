---
exam:
  id: a2-drill-fx-info
  format: torfl
  level: A2
  mode: drill
  title: { ru: 'Запишите информацию', en: 'Info capture' }
  blurb: 'Listen to the dialogue and capture the details — two fixture items.'
  subtests:
    - id: listening
      kind: listening
      title: { ru: 'Аудирование', en: 'Listening' }
      instructions: { ru: 'Прослушайте диалог и ответьте на вопросы.', en: 'Listen to the dialogue and answer.' }
      durationMin: 5
      dictionary: false
      navigation: linear
      pointsPerItem: 6
      maxPoints: 12
      parts:
        - id: p1
          instructions: { ru: 'Задания 1–2. Прослушайте диалог.', en: 'Items 1–2. Listen to the dialogue.' }
          items:
            - id: di01
              kind: choice
              topic: listen-detail
              audio: { storyId: ls-01 }
              stem: 'Встреча будет в …'
              options: ['субботу', 'пятницу', 'воскресенье']
              answer: 0
              explain: 'Ты свободен в субботу? — the meeting is on Saturday (в субботу).'
            - id: di02
              kind: typed
              topic: listen-info
              prompt: 'Друзья встретятся (где?)'
              accept: ['у кинотеатра', 'около кинотеатра']
              half: ['у кинотеатр', 'кинотеатр']
              explain: 'Встретимся у кинотеатра — «у» + genitive for the meeting place. The bare or wrong-case form earns half credit.'
---

T75 A2 drill fixture: one listening subtest (linear, no audioPlays — drills do not
set it), a choice item and a typed 6/3 item (pointsPerItem 6, maxPoints 12). The
dialogue in ls-01 contains both answers (Saturday; у кинотеатра).
