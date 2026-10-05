---
exam:
  id: a1-drill-fx
  format: torfl
  level: A1
  mode: drill
  title: { ru: 'Падежи: предложный', en: 'Cases: prepositional' }
  blurb: 'Where? в / на + prepositional — six fixture items.'
  subtests:
    - id: lexgram
      kind: lexgram
      title: { ru: 'Лексика. Грамматика', en: 'Vocabulary. Grammar' }
      instructions: { ru: 'Выберите один вариант ответа.', en: 'Choose one answer.' }
      durationMin: 10
      dictionary: false
      navigation: free
      pointsPerItem: 1
      maxPoints: 6
      parts:
        - id: p1
          instructions: { ru: 'Задания 1–6.', en: 'Items 1–6.' }
          items:
            - id: dr01
              kind: choice
              topic: case-prep
              stem: 'Кирилл работает … радио.'
              stemEn: 'Kirill works at the radio station.'
              options: ['в', 'на']
              answer: 1
              explain: 'на радио — «на» with places that are events/stations/open areas (на работе, на почте, на радио).'
            - id: dr02
              kind: choice
              topic: case-prep
              stem: 'Елена Сергеевна сейчас в …'
              options: ['больница', 'больнице', 'больницу']
              answer: 1
              explain: 'где? в + prepositional: больница → в больнице.'
            - id: dr03
              kind: choice
              topic: case-prep
              stem: 'Мы говорили о …'
              options: ['Москва', 'Москве', 'Москву', 'Москвой']
              answer: 1
              explain: 'о ком / о чём? о + prepositional: о Москве.'
            - id: dr04
              kind: choice
              topic: case-prep
              stem: 'Витя живёт на … этаже.'
              options: ['пятый', 'пятом', 'пятого']
              answer: 1
              explain: 'на каком этаже? adjective in the prepositional too: на пятом этаже.'
            - id: dr05
              kind: choice
              topic: case-prep
              stem: 'Оксана сидит в …'
              options: ['банк', 'банке']
              answer: 1
              explain: 'в банке — где? в + prepositional.'
            - id: dr06
              kind: typed
              topic: case-prep
              prompt: 'Лейтенант Громов отдыхает в (парк).'
              accept: ['парке']
              half: ['парк', 'парку']
              explain: 'в парке — prepositional of «парк» (-е). The bare form or a dative earns half credit.'
---

T67 fixture drill: one lexgram subtest, five choice items with `explain` and
one `typed` item with `half` credit.
