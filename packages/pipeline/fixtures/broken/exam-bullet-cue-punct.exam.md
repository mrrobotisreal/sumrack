---
pack:
  id: a1-exam-fixture
  version: 1
  type: exam
  title: { ru: "ТРКИ: тестовый пакет", en: "TORFL: fixture pack" }
  level: A1
  tags: ["torfl", "torfl:fixture"]
  category: torfl
exam:
  id: x-cue
  format: torfl
  level: A1
  mode: drill
  title: { ru: 'Сломано', en: 'Broken' }
  subtests:
    - id: s1
      kind: writing
      title: { ru: 'Тест', en: 'Test' }
      instructions: { ru: 'Тест.', en: 'Test.' }
      durationMin: 10
      dictionary: false
      navigation: free
      maxPoints: 100
      parts:
        - id: p1
          instructions: { ru: 'Тест.', en: 'Test.' }
          items:
            - id: wr01
              kind: writing
              topic: write-letter
              task: { ru: 'Напишите письмо другу.', en: 'Write to a friend.' }
              bullets:
                - { id: b1, text: { ru: 'как вас зовут', en: 'your name' }, cues: ['зовут'] }
                - { id: b2, text: { ru: 'где вы живёте', en: 'where you live' }, cues: ['живу!'] }
                - { id: b3, text: { ru: 'где вы работаете', en: 'where you work' }, cues: ['работа*'] }
              minSentences: 10
---

T67 broken fixture — annotate together with ../exam-fixture/rd-01.draft.md and
ls-01.draft.md (see test/exam.test.ts).
