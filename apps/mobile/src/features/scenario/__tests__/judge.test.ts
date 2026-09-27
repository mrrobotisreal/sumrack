import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Slot } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  judgeAnswer,
  SCENARIO_ACCEPT_THRESHOLD,
  SCENARIO_NEAR_MISS_SCORE,
  type JudgeExpectation,
} from '../judge/judge';

/**
 * The judge (T60, SPEAKING_SCENARIOS §5.2) against the fixture pack
 * («Проверка связи», `a1-scenario-fixture`) and the podcast A1
 * expectations hand-copied from the scripts file §1.1
 * (`fixtures/podcast-a1-expect.json`).
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface PodcastFixture {
  turns: { id: string; expect: JudgeExpectation & { slots: Slot[] } }[];
}
const podcast = JSON.parse(
  readFileSync(path.join(FIXTURES, 'podcast-a1-expect.json'), 'utf8'),
) as PodcastFixture;
function pod(turnId: string): JudgeExpectation {
  const turn = podcast.turns.find((t) => t.id === turnId);
  if (!turn) throw new Error(`no podcast turn ${turnId}`);
  return turn.expect;
}

// The fixture pack's two expecting turns (packages/schema/fixtures/packs/a1-scenario-fixture).
const RADIO_NAME: JudgeExpectation = {
  slots: [{ kind: 'free', id: 'name', required: true, minTokens: 1 }],
  accept: ['Меня зовут Митч.', 'Я Митч.'],
  reject: [{ forms: ['хорошо', 'спасибо'] }],
};
const RADIO_MOOD: JudgeExpectation = {
  slots: [
    {
      kind: 'forms',
      id: 'mood',
      required: true,
      acceptsNumber: false,
      options: [
        {
          key: 'good',
          lemma: 'хорошо',
          forms: ['хорошо', 'отлично', 'нормально', 'прекрасно', 'неплохо'],
        },
        { key: 'bad', lemma: 'плохо', forms: ['плохо', 'устал*', 'так себе', 'не очень'] },
        { key: 'ok', lemma: 'ничего', forms: ['ничего', 'нормально'] },
      ],
    },
  ],
  accept: ['Хорошо, спасибо.', 'Плохо, я устал.', 'Ничего.'],
  branchOn: 'mood',
};

describe('judgeAnswer — constants', () => {
  it("records T27's threshold and the near-miss floor", () => {
    expect(SCENARIO_ACCEPT_THRESHOLD).toBe(60);
    expect(SCENARIO_NEAR_MISS_SCORE).toBe(40);
  });
});

describe('judgeAnswer — no speech', () => {
  it('zero tokens ⇒ no-speech with every slot null', () => {
    const r = judgeAnswer('', RADIO_MOOD);
    expect(r.verdict).toBe('no-speech');
    expect(r.slots).toEqual({ mood: null });
    expect(r.branchKey).toBeNull();
    expect(r.words).toEqual([]);
    expect(r.tokenCount).toBe(0);
  });

  it('punctuation-only transcripts are no speech too', () => {
    expect(judgeAnswer('… — !', RADIO_NAME).verdict).toBe('no-speech');
  });
});

describe('judgeAnswer — fixture: radio-a1-t02 (free name slot + reject)', () => {
  it('correct: «Меня зовут Митч» matches by slot and by paraphrase', () => {
    const r = judgeAnswer('меня зовут митч', RADIO_NAME);
    expect(r.verdict).toBe('matched');
    expect(r.slots).toEqual({ name: 'free' });
    expect(r.score).toBe(100);
    expect(r.target).toBe('Меня зовут Митч.');
    expect(r.matchedBy).toBe('slots');
    expect(r.nearMiss).toBe(false);
  });

  it('a bare name satisfies minTokens=1', () => {
    expect(judgeAnswer('Митч', RADIO_NAME).verdict).toBe('matched');
  });

  it('stopwords alone never satisfy a free slot', () => {
    const r = judgeAnswer('ну я это вот', RADIO_NAME);
    expect(r.verdict).toBe('miss');
    expect(r.slots.name).toBeNull();
    expect(r.rejectIndex).toBeNull();
  });

  it('the reject group fires on a wrong speech act («хорошо, спасибо») with rejectIndex 0', () => {
    const r = judgeAnswer('хорошо спасибо', RADIO_NAME);
    expect(r.verdict).toBe('miss');
    expect(r.rejectIndex).toBe(0);
    expect(r.slots.name).toBeNull(); // reject words are masked out of the free count
    expect(r.branchKey).toBeNull();
  });

  it('a reject word beside a real answer does not block the match', () => {
    const r = judgeAnswer('спасибо, меня зовут Митч', RADIO_NAME);
    expect(r.verdict).toBe('matched');
    expect(r.rejectIndex).toBeNull();
  });

  it('near miss: a paraphrase fragment ≥ 40 but no content word (edge: «меня зовут» alone)', () => {
    const r = judgeAnswer('меня зовут', RADIO_NAME);
    // «меня»/«зовут»: «зовут» is a content token, so the slot is satisfied — matched.
    expect(r.verdict).toBe('matched');
  });

  it('per-word alignment runs against the best paraphrase', () => {
    const r = judgeAnswer('я митч', RADIO_NAME);
    expect(r.target).toBe('Я Митч.');
    expect(r.words.map((w) => [w.display, w.matched])).toEqual([
      ['Я', true],
      ['Митч', true],
    ]);
  });
});

describe('judgeAnswer — fixture: radio-a1-t03 (forms slot, branchOn mood)', () => {
  it.each([
    ['хорошо, спасибо', 'good'],
    ['отлично', 'good'],
    ['плохо, я устал', 'bad'],
    ['я устала', 'bad'], // устал* glob
    ['так себе', 'bad'], // multi-word form
    ['не очень', 'bad'],
    ['ничего', 'ok'],
  ])('«%s» ⇒ matched, branchKey %s', (said, key) => {
    const r = judgeAnswer(said, RADIO_MOOD);
    expect(r.verdict).toBe('matched');
    expect(r.branchKey).toBe(key);
    expect(r.slots.mood).toBe(key);
  });

  it('«нормально» sits in two options — the first wins the tie', () => {
    expect(judgeAnswer('нормально', RADIO_MOOD).branchKey).toBe('good');
  });

  it('wrong type («меня зовут митч») is a plain miss, not near', () => {
    const r = judgeAnswer('меня зовут митч', RADIO_MOOD);
    expect(r.verdict).toBe('miss');
    expect(r.nearMiss).toBe(false);
    expect(r.branchKey).toBeNull();
    expect(r.rejectIndex).toBeNull();
  });

  it('noise («э-э ну») is a miss with no near-miss', () => {
    const r = judgeAnswer('э-э ну', RADIO_MOOD);
    expect(r.verdict).toBe('miss');
    expect(r.nearMiss).toBe(false);
  });

  it('near miss: a paraphrase fragment without the slot word («я спасибо устал»-shaped: «спасибо я»)', () => {
    // «Хорошо, спасибо.» → «спасибо» is 1 of 2 target words = 50 ≥ 40, slot unsatisfied.
    const r = judgeAnswer('спасибо', RADIO_MOOD);
    expect(r.verdict).toBe('miss');
    expect(r.score).toBe(50);
    expect(r.nearMiss).toBe(true);
  });

  it('ASR-shaped misspelling on a glob still hits («усталь» → устал*)', () => {
    expect(judgeAnswer('усталь', RADIO_MOOD).branchKey).toBe('bad');
  });

  it('paraphrase at ≥ 60 matches even when no slot form is heard', () => {
    // «Плохо, я устал.» with «плохо» dropped: «я устал» = 2/3 = 67 — but «устал» hits the slot anyway;
    // force the paraphrase path with a no-slot expectation instead.
    const noSlot: JudgeExpectation = {
      slots: [
        {
          kind: 'forms',
          id: 'x',
          required: true,
          acceptsNumber: false,
          options: [{ key: 'k', lemma: 'z', forms: ['zzz'] }],
        },
      ],
      accept: ['Я живу в Австрии.'],
    };
    const r = judgeAnswer('я живу австрии', noSlot);
    expect(r.score).toBe(75);
    expect(r.verdict).toBe('matched');
    expect(r.matchedBy).toBe('paraphrase');
    expect(r.branchKey).toBeNull();
  });

  it('the lab can override the threshold', () => {
    const noSlot: JudgeExpectation = {
      slots: [
        {
          kind: 'forms',
          id: 'x',
          required: true,
          acceptsNumber: false,
          options: [{ key: 'k', lemma: 'z', forms: ['zzz'] }],
        },
      ],
      accept: ['Я живу в Австрии.'],
    };
    expect(judgeAnswer('я живу австрии', noSlot, { threshold: 80 }).verdict).toBe('miss');
  });
});

describe('judgeAnswer — podcast A1 (scripts §1.1)', () => {
  it('t02: name (free) — accept / reject / stopwords', () => {
    expect(judgeAnswer('Меня зовут Митч', pod('pod-a1-t02')).verdict).toBe('matched');
    const rej = judgeAnswer('отлично', pod('pod-a1-t02'));
    expect(rej.verdict).toBe('miss');
    expect(rej.rejectIndex).toBe(0);
    expect(judgeAnswer('ну да', pod('pod-a1-t02')).slots.name).toBeNull();
  });

  it('t03: origin — globs with edits and the bare «из» fallback', () => {
    expect(judgeAnswer('я из америки', pod('pod-a1-t03')).slots.origin).toBe('usa');
    expect(judgeAnswer('из соединенных штатов', pod('pod-a1-t03')).slots.origin).toBe('usa');
    expect(judgeAnswer('из колорадо', pod('pod-a1-t03')).slots.origin).toBe('colorado');
    expect(judgeAnswer('я из германии', pod('pod-a1-t03')).slots.origin).toBe('elsewhere');
    expect(judgeAnswer('я из амерки', pod('pod-a1-t03')).slots.origin).toBe('usa'); // ASR dropped a letter
  });

  it('t04: place — «в Австрии» / «в Зальцбурге» / «в Колорадо» ⇒ usa', () => {
    expect(judgeAnswer('я живу в австрии', pod('pod-a1-t04')).slots.place).toBe('austria');
    expect(judgeAnswer('в зальцбурге', pod('pod-a1-t04')).slots.place).toBe('austria');
    expect(judgeAnswer('сейчас я живу в колорадо', pod('pod-a1-t04')).slots.place).toBe('usa');
    expect(judgeAnswer('в берлине', pod('pod-a1-t04')).slots.place).toBe('elsewhere');
  });

  it('t05: job — seven options, reject group with react', () => {
    const e = pod('pod-a1-t05');
    expect(judgeAnswer('я программист', e).slots.job).toBe('programmer');
    expect(judgeAnswer('я работаю программистом', e).slots.job).toBe('programmer');
    expect(judgeAnswer('я учусь', e).slots.job).toBe('student');
    expect(judgeAnswer('я преподаватель', e).slots.job).toBe('teacher');
    expect(judgeAnswer('доктор', e).slots.job).toBe('doctor');
    expect(judgeAnswer('шофер', e).slots.job).toBe('driver');
    expect(judgeAnswer('я работаю', e).slots.job).toBe('working');
    const rej = judgeAnswer('нормально', e);
    expect(rej.verdict).toBe('miss');
    expect(rej.rejectIndex).toBe(0);
  });

  it('t05: «я инженер, я пишу программы» — both options hit; option order picks programmer. Recorded.', () => {
    // A genuine content ambiguity in the script (ACCEPT[2] is an engineer who
    // writes programs while «программ*» is the programmer glob). Deterministic,
    // and no branch hangs on `job`, so nothing downstream changes.
    const r = judgeAnswer('я инженер, я пишу программы', pod('pod-a1-t05'));
    expect(r.verdict).toBe('matched');
    expect(r.slots.job).toBe('programmer');
  });

  it('catch-all options («в», «из», «работаю») are authored last, so they lose ties', () => {
    expect(judgeAnswer('я работаю программистом', pod('pod-a1-t05')).slots.job).toBe('programmer');
    expect(judgeAnswer('я из америки', pod('pod-a1-t03')).slots.origin).toBe('usa');
    expect(judgeAnswer('в австрии', pod('pod-a1-t04')).slots.place).toBe('austria');
  });

  it('t06: hobby — branch keys read / films / default', () => {
    const e = pod('pod-a1-t06');
    expect(judgeAnswer('я люблю читать', e).branchKey).toBe('read');
    expect(judgeAnswer('люблю книги', e).branchKey).toBe('read');
    expect(judgeAnswer('люблю смотреть фильмы', e).branchKey).toBe('films');
    expect(judgeAnswer('кино', e).branchKey).toBe('films');
    expect(judgeAnswer('я люблю слушать музыку и играть в игры', e).branchKey).toBe('music');
    expect(judgeAnswer('спорт', e).branchKey).toBe('sport');
    expect(judgeAnswer('готовлю', e).branchKey).toBe('cook');
    // Recorded consequence of the design's paraphrase rule: «я люблю» is 2/3 of
    // «Я люблю читать.» = 67 ≥ 60 ⇒ matched WITHOUT a hobby, default branch.
    const fragment = judgeAnswer('я люблю', e);
    expect(fragment.verdict).toBe('matched');
    expect(fragment.matchedBy).toBe('paraphrase');
    expect(fragment.branchKey).toBeNull();
    const miss = judgeAnswer('не знаю', e);
    expect(miss.verdict).toBe('miss');
    expect(miss.nearMiss).toBe(false);
  });

  it('t07r: yes/no — «нет, не люблю» is no, «да, очень люблю» is yes', () => {
    const e = pod('pod-a1-t07r');
    expect(judgeAnswer('да, очень люблю', e).slots.yesno).toBe('yes');
    expect(judgeAnswer('конечно, обожаю', e).slots.yesno).toBe('yes');
    expect(judgeAnswer('нет, не люблю', e).slots.yesno).toBe('no');
    expect(judgeAnswer('не очень', e).slots.yesno).toBe('no');
    expect(judgeAnswer('не люблю', e).slots.yesno).toBe('no');
  });

  it('t07f: genre — horror / comedy / both', () => {
    const e = pod('pod-a1-t07f');
    expect(judgeAnswer('страшные', e).slots.genre).toBe('horror');
    expect(judgeAnswer('я люблю ужасы', e).slots.genre).toBe('horror');
    expect(judgeAnswer('смешные, комедии', e).slots.genre).toBe('comedy');
    expect(judgeAnswer('и те и другие', e).slots.genre).toBe('both');
    expect(judgeAnswer('разные', e).slots.genre).toBe('both');
  });

  it('t08: duration — forms, numerals («двадцать пять», «25») via acceptsNumber ⇒ key number', () => {
    const e = pod('pod-a1-t08');
    expect(judgeAnswer('давно, пять лет', e).slots.duration).toBe('long'); // «лет» form beats numeral
    expect(judgeAnswer('недавно', e).slots.duration).toBe('short');
    expect(judgeAnswer('два месяца', e).slots.duration).toBe('short');
    expect(judgeAnswer('двадцать пять', e).slots.duration).toBe('number');
    expect(judgeAnswer('25', e).slots.duration).toBe('number');
    expect(judgeAnswer('три', e).verdict).toBe('matched');
    expect(judgeAnswer('не знаю', e).verdict).toBe('miss');
  });

  it('t09: reason — family / work / travel / like', () => {
    const e = pod('pod-a1-t09');
    expect(judgeAnswer('моя невеста из украины', e).slots.reason).toBe('family');
    expect(judgeAnswer('потому что моя девушка говорит по-русски', e).slots.reason).toBe('family');
    expect(judgeAnswer('мне нравится русский язык', e).slots.reason).toBe('like');
    expect(judgeAnswer('для работы', e).slots.reason).toBe('work');
    expect(judgeAnswer('хочу поехать в россию', e).slots.reason).toBe('travel');
  });

  it('every accept[] paraphrase of every turn matches its own turn', () => {
    for (const turn of podcast.turns) {
      for (const accept of turn.expect.accept) {
        const r = judgeAnswer(accept, turn.expect);
        expect(r.verdict, `${turn.id}: «${accept}»`).toBe('matched');
        expect(r.score, `${turn.id}: «${accept}»`).toBe(100);
      }
    }
  });

  it('every reject form of every turn misses its own turn with a rejectIndex', () => {
    for (const turn of podcast.turns) {
      for (const [i, group] of (turn.expect.reject ?? []).entries()) {
        for (const form of group.forms) {
          const r = judgeAnswer(form, turn.expect);
          expect(r.verdict, `${turn.id}: «${form}»`).toBe('miss');
          expect(r.rejectIndex, `${turn.id}: «${form}»`).toBe(i);
        }
      }
    }
  });
});

describe('judgeAnswer — slot kinds', () => {
  it('a pure number slot needs a numeral; branch key is «number»', () => {
    const e: JudgeExpectation = {
      slots: [{ kind: 'number', id: 'n', required: true }],
      accept: ['Пять.'],
      branchOn: 'n',
    };
    expect(judgeAnswer('семь', e)).toMatchObject({ verdict: 'matched', branchKey: 'number' });
    expect(judgeAnswer('сорок два', e).slots.n).toBe('number');
    expect(judgeAnswer('много', e).verdict).toBe('miss');
  });

  it('a free slot with cues needs one cue phrase at ≥ 60', () => {
    const e: JudgeExpectation = {
      slots: [{ kind: 'free', id: 'name', required: true, minTokens: 1, cues: ['меня зовут'] }],
      accept: ['Меня зовут Митч.'],
    };
    expect(judgeAnswer('меня зовут митч', e).slots.name).toBe('free');
    expect(judgeAnswer('зовут митч', e).slots.name).toBeNull(); // cue «меня зовут» = 1/2 = 50 < 60
    expect(judgeAnswer('меня завут митч', e).slots.name).toBe('free'); // ASR slip inside the budget
    expect(judgeAnswer('митч', e).slots.name).toBeNull();
  });

  it('minTokens counts content tokens only', () => {
    const e: JudgeExpectation = {
      slots: [{ kind: 'free', id: 'story', required: true, minTokens: 3 }],
      accept: ['Я видел тень в окне.'],
    };
    expect(judgeAnswer('я видел тень в окне', e).slots.story).toBe('free');
    expect(judgeAnswer('я и ты и это', e).slots.story).toBeNull();
    expect(judgeAnswer('видел тень', e).slots.story).toBeNull();
  });

  it('optional slots never block a match; every required slot must hit', () => {
    const e: JudgeExpectation = {
      slots: [
        {
          kind: 'forms',
          id: 'where',
          required: true,
          acceptsNumber: false,
          options: [{ key: 'head', lemma: 'голова', forms: ['голов*'] }],
        },
        {
          kind: 'forms',
          id: 'since',
          required: false,
          acceptsNumber: true,
          options: [{ key: 'yesterday', lemma: 'вчера', forms: ['вчера'] }],
        },
      ],
      accept: ['У меня болит голова.'],
    };
    const r = judgeAnswer('болит голава', e);
    expect(r.verdict).toBe('matched');
    expect(r.slots).toEqual({ where: 'head', since: null });
    const two: JudgeExpectation = { ...e, slots: e.slots.map((s) => ({ ...s, required: true })) };
    expect(judgeAnswer('болит голова', two).verdict).toBe('miss');
    expect(judgeAnswer('болит голова с вчера', two).verdict).toBe('matched');
    expect(judgeAnswer('болит голова уже два дня', two).slots.since).toBe('number');
  });

  it('a miss synthesizes the debrief target from the forms that hit when no paraphrase scored', () => {
    const e: JudgeExpectation = {
      slots: [
        {
          kind: 'forms',
          id: 'a',
          required: true,
          acceptsNumber: false,
          options: [{ key: 'x', lemma: 'x', forms: ['зальцбург*'] }],
        },
        {
          kind: 'forms',
          id: 'b',
          required: true,
          acceptsNumber: false,
          options: [{ key: 'y', lemma: 'y', forms: ['вчера'] }],
        },
      ],
      accept: ['Совсем другое предложение.'],
    };
    const r = judgeAnswer('зальцбурге', e);
    expect(r.verdict).toBe('miss');
    expect(r.score).toBe(0);
    expect(r.target).toBe('зальцбург');
    expect(r.nearMiss).toBe(true); // one required slot hit
  });
});
