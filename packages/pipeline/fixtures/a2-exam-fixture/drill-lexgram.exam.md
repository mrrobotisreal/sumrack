---
exam:
  id: a2-drill-fx-time
  format: torfl
  level: A2
  mode: drill
  title: { ru: 'Время и даты', en: 'Time and dates' }
  blurb: 'Time expressions in the accusative and genitive — six fixture items.'
  subtests:
    - id: lexgram
      kind: lexgram
      title: { ru: 'Лексика. Грамматика', en: 'Vocabulary. Grammar' }
      instructions: { ru: 'Выберите один вариант ответа.', en: 'Choose one answer.' }
      durationMin: 5
      dictionary: false
      navigation: free
      pointsPerItem: 1
      maxPoints: 6
      parts:
        - id: p1
          instructions: { ru: 'Задания 1–6.', en: 'Items 1–6.' }
          items:
            - id: dt01
              kind: choice
              topic: case-time
              stem: 'Концерт начинается в … часов вечера.'
              stemEn: 'The concert starts at seven in the evening.'
              options: ['семь', 'семи']
              answer: 0
              explain: 'в + accusative for clock time: в семь часов.'
            - id: dt02
              kind: choice
              topic: case-time
              stem: 'Мы встречаемся в … утра.'
              stemEn: 'We meet at eight in the morning.'
              options: ['восемь', 'восьми', 'восемью']
              answer: 0
              explain: 'в восемь утра — the number stays in the accusative.'
            - id: dt03
              kind: choice
              topic: case-time
              stem: 'Урок заканчивается в … часа.'
              stemEn: 'The lesson ends at two o''clock.'
              options: ['два', 'двух', 'двум']
              answer: 0
              explain: 'в два часа — accusative (два), with часа in the genitive singular after two.'
            - id: dt04
              kind: choice
              topic: case-time
              stem: 'Мы поедем в … .'
              stemEn: 'We will go on Friday.'
              options: ['пятница', 'пятницу', 'пятницы']
              answer: 1
              explain: 'в пятницу — days of the week take в + accusative.'
            - id: dt05
              kind: choice
              topic: case-time
              stem: 'Мы будем дома в … вечера.'
              stemEn: 'We will be home at ten in the evening.'
              options: ['десять', 'десяти']
              answer: 0
              explain: 'в десять вечера — the accusative of the hour, not the genitive.'
            - id: dt06
              kind: typed
              topic: case-time
              prompt: 'Встреча будет в (суббота). Напишите правильную форму.'
              accept: ['субботу']
              half: ['суббота', 'субботе']
              explain: 'в субботу — the day of the week in the accusative (в + -у). The bare nominative or a wrong case earns half credit.'
---

T75 A2 drill fixture: one lexgram subtest, five choice items with stemEn and explain,
and one typed item with half credit (6 items, 6 points).
