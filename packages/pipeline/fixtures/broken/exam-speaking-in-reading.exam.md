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
  id: x-kind
  format: torfl
  level: A1
  mode: drill
  title: { ru: 'Сломано', en: 'Broken' }
  subtests:
    - id: s1
      kind: reading
      title: { ru: 'Тест', en: 'Test' }
      instructions: { ru: 'Тест.', en: 'Test.' }
      durationMin: 10
      dictionary: false
      navigation: free
      maxPoints: 4
      parts:
        - id: p1
          instructions: { ru: 'Тест.', en: 'Test.' }
          items:
            - { id: rd01, kind: choice, topic: read-detail, stem: 'Анна живёт в …', options: ['Москве', 'Сочи'], answer: 0, points: 4 }
            - id: sp01
              kind: speaking-reply
              topic: speak-reply
              prompt: { storyId: ls-01, sentenceIds: [tfa1fx01l01-s01] }
              expect: { slots: [{ kind: free, id: a, required: true }], accept: ['Я в Москве.'] }
---

T67 broken fixture — annotate together with ../exam-fixture/rd-01.draft.md and
ls-01.draft.md (see test/exam.test.ts).
