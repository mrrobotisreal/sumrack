import type { ExamSubtestKind } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import { predictVerdict as predictViaReadiness } from '../readiness';
import { predictVerdict, verdict, verdictHeadline } from '../verdict';

const all = (n: number): Record<ExamSubtestKind, number> => ({
  writing: n,
  lexgram: n,
  reading: n,
  listening: n,
  speaking: n,
});

describe('verdict (§6.3)', () => {
  it('all five ≥ 66 → pass, nothing to retake (66.0 is in)', () => {
    expect(verdict(all(66))).toEqual({
      verdict: 'pass',
      retake: [],
      provisional: false,
      missing: [],
    });
    expect(verdict(all(100)).verdict).toBe('pass');
  });

  it('65.9 is NOT a pass: one subtest there → borderline', () => {
    const r = verdict({ ...all(80), reading: 65.9 });
    expect(r.verdict).toBe('pass-borderline');
    expect(r.retake).toEqual([]);
  });

  it('exactly one in [60, 66) → pass-borderline (60.0 inclusive)', () => {
    expect(verdict({ ...all(75), listening: 60 }).verdict).toBe('pass-borderline');
    expect(verdict({ ...all(75), writing: 63.4 }).verdict).toBe('pass-borderline');
  });

  it('59.9 → fail, retake exactly that subtest', () => {
    expect(verdict({ ...all(75), listening: 59.9 })).toMatchObject({
      verdict: 'fail',
      retake: ['listening'],
    });
  });

  it('two borderline → fail; the best one is «spent», the other is retaken', () => {
    const r = verdict({ ...all(75), listening: 62, reading: 64 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['listening']);
  });

  it('one borderline + one below 60 → fail; only the sub-60 one is retaken', () => {
    const r = verdict({ ...all(75), lexgram: 62, speaking: 40 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['speaking']);
  });

  it('two sub-60 → fail, both retaken, in official order', () => {
    const r = verdict({ ...all(80), speaking: 30, lexgram: 50 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['lexgram', 'speaking']);
  });

  it('all five failing → every subtest in the retake list', () => {
    expect(verdict(all(10)).retake).toEqual([
      'writing',
      'lexgram',
      'reading',
      'listening',
      'speaking',
    ]);
  });

  it('boundary table around 59.9 / 60 / 65.9 / 66 on one subtest', () => {
    const base = all(90);
    const at = (pct: number) => verdict({ ...base, lexgram: pct }).verdict;
    expect([59.9, 60, 65.9, 66].map(at)).toEqual([
      'fail',
      'pass-borderline',
      'pass-borderline',
      'pass',
    ]);
  });

  it('a missing or null subtest → no verdict, and names what is missing', () => {
    const r = verdict({ lexgram: 80, reading: 80, listening: 80 });
    expect(r.verdict).toBeNull();
    expect(r.missing).toEqual(['writing', 'speaking']);
    expect(r.retake).toEqual([]);
    expect(verdict({ ...all(80), speaking: null }).verdict).toBeNull();
    expect(verdict({}).missing).toHaveLength(5);
  });

  it('provisional is true iff a flagged subtest is part of a full verdict', () => {
    expect(verdict(all(70), { writing: true }).provisional).toBe(true);
    expect(verdict(all(70), { speaking: true, writing: false }).provisional).toBe(true);
    expect(verdict(all(70), { writing: false }).provisional).toBe(false);
    expect(verdict({ lexgram: 70 }, { writing: true }).provisional).toBe(false);
  });
});

describe('predictVerdict (unknown = fail)', () => {
  it('re-exported from readiness, identical function', () => {
    expect(predictViaReadiness).toBe(predictVerdict);
  });

  it('an unknown subtest is a failure to retake', () => {
    const r = predictVerdict({ lexgram: 80, reading: 80, listening: 80 });
    expect(r.verdict).toBe('fail');
    expect(r.retake).toEqual(['writing', 'speaking']);
    expect(predictVerdict({}).retake).toHaveLength(5);
  });
});

describe('verdictHeadline', () => {
  it('speaks SPbU', () => {
    expect(verdictHeadline('pass', [])).toBe('Сертификат: выдан бы');
    expect(verdictHeadline('pass-borderline', [])).toContain('на грани');
    expect(verdictHeadline('fail', ['reading'])).toBe('Нужно пересдать');
  });
});

describe('level (T75)', () => {
  const sets: Record<string, Record<ExamSubtestKind, number>> = {
    'all 66': all(66),
    'one at 62, rest 70': { ...all(70), reading: 62 },
    'one at 59': { ...all(70), listening: 59 },
    'two at 62': { ...all(70), writing: 62, speaking: 62 },
  };

  it('predictVerdict(p, "A2") ≡ predictVerdict(p) ≡ predictVerdict(p, "A1") (same rule)', () => {
    for (const p of Object.values(sets)) {
      expect(predictVerdict(p, 'A2')).toEqual(predictVerdict(p));
      expect(predictVerdict(p, 'A1')).toEqual(predictVerdict(p));
    }
  });

  it('verdict(p, {}, "A2") ≡ verdict(p)', () => {
    for (const p of Object.values(sets)) {
      expect(verdict(p, {}, 'A2')).toEqual(verdict(p));
    }
  });
});
