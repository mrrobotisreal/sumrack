import { describe, expect, it } from 'vitest';
import { VoiceDirectionSchema, type VoiceDirection } from '../src/frontmatter.ts';
import {
  CATEGORY_DEFAULT_REGISTER,
  DEFAULT_VOICE,
  REGISTERS,
  REGISTER_SLUGS,
  applyRegister,
  resolveRegisterSlug,
} from '../src/registers.ts';

/**
 * M14 register presets (LIBRARY_CATEGORIES §2.5, ADR-0016): the precedence
 * of explicit `register` → category default → untouched, with authored
 * fields winning field by field and `settings` merging key-wise.
 */

const parse = (raw: unknown): VoiceDirection => VoiceDirectionSchema.parse(raw);

describe('REGISTERS table', () => {
  it('covers every slug with a complete five-knob settings block and a Russian NFC stylePrompt', () => {
    for (const slug of REGISTER_SLUGS) {
      const r = REGISTERS[slug];
      expect(Object.keys(r.settings).sort()).toEqual(
        ['similarityBoost', 'speed', 'stability', 'style', 'useSpeakerBoost'].sort(),
      );
      expect(r.settings.useSpeakerBoost).toBe(true);
      expect(r.stylePrompt).toBe(r.stylePrompt.normalize('NFC'));
      expect(/[А-Яа-яЁё]/.test(r.stylePrompt)).toBe(true);
      expect(r.label).toBe(r.label.normalize('NFC'));
    }
  });

  it('narrator = the No End House bible §5.6 v2 settings (0.50 / 0.75 / 0.00 / 1.00 / true)', () => {
    expect(REGISTERS.narrator.settings).toEqual({
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1,
      useSpeakerBoost: true,
    });
  });

  it('maps every category to its default register', () => {
    expect(CATEGORY_DEFAULT_REGISTER).toEqual({
      stories: 'narrator',
      news: 'anchor',
      education: 'lecturer',
      podcast: 'host',
      documentary: 'voiceover',
      travel: 'guide',
    });
    expect(DEFAULT_VOICE).toBe('elevenlabs:Mr. Wintrow');
  });
});

describe('VoiceDirectionSchema with register', () => {
  it('accepts a direction with register alone (voice/style optional then)', () => {
    const d = parse({ id: 'nw-anchor', register: 'anchor' });
    expect(d.register).toBe('anchor');
    expect(d.voice).toBeUndefined();
    expect(d.style).toBeUndefined();
  });

  it('rejects a direction with neither voice nor register, naming both missing fields', () => {
    const result = VoiceDirectionSchema.safeParse({ id: 'x' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(paths).toContain('voice: voice is required unless "register" is set');
    expect(paths).toContain('style: style is required unless "register" is set');
  });

  it('rejects voice-only and style-only directions without a register', () => {
    expect(VoiceDirectionSchema.safeParse({ id: 'x', voice: 'elevenlabs:A' }).success).toBe(false);
    expect(VoiceDirectionSchema.safeParse({ id: 'x', style: 'neutral' }).success).toBe(false);
  });

  it('rejects an unknown register slug', () => {
    expect(VoiceDirectionSchema.safeParse({ id: 'x', register: 'shouter' }).success).toBe(false);
  });

  it('still accepts a fully authored pre-M14 direction', () => {
    const d = parse({ id: 'x', voice: 'elevenlabs:Ivan', style: 'creepy-whisper' });
    expect(d.register).toBeUndefined();
  });
});

describe('applyRegister', () => {
  it('register only: voice → Mr. Wintrow, style → slug, settings + stylePrompt from the preset', () => {
    const r = applyRegister(parse({ id: 'nw', register: 'anchor' }));
    expect(r).toEqual({
      id: 'nw',
      register: 'anchor',
      voice: DEFAULT_VOICE,
      style: 'anchor',
      stylePrompt: REGISTERS.anchor.stylePrompt,
      settings: REGISTERS.anchor.settings,
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // no undefined keys
  });

  it('register + partial settings: authored keys override only themselves (key-wise merge)', () => {
    const r = applyRegister(
      parse({ id: 'nw', register: 'anchor', settings: { stability: 0.9, useSpeakerBoost: false } }),
    );
    expect(r.settings).toEqual({
      ...REGISTERS.anchor.settings,
      stability: 0.9,
      useSpeakerBoost: false,
    });
  });

  it('register + explicit voice / style / stylePrompt: authored fields win', () => {
    const r = applyRegister(
      parse({
        id: 'nw',
        register: 'host',
        voice: 'elevenlabs:Guest',
        style: 'guest-host',
        stylePrompt: 'Привет.',
      }),
    );
    expect(r.voice).toBe('elevenlabs:Guest');
    expect(r.style).toBe('guest-host');
    expect(r.stylePrompt).toBe('Привет.');
    expect(r.settings).toEqual(REGISTERS.host.settings);
  });

  it('explicit register beats the pack category', () => {
    const r = applyRegister(parse({ id: 'x', register: 'lecturer' }), 'news');
    expect(r.style).toBe('lecturer');
    expect(r.settings).toEqual(REGISTERS.lecturer.settings);
  });

  it('category default applies when settings, stylePrompt and style are all absent', () => {
    const r = applyRegister(parse({ id: 'x', voice: 'elevenlabs:Ivan', style: 'neutral' }), 'news');
    // …but this one HAS a style, so it is untouched:
    expect(r).toEqual({ id: 'x', voice: 'elevenlabs:Ivan', style: 'neutral' });

    // A register-less, style-less direction only parses when voice+style are
    // present, so the category path is reached via a hand-built direction —
    // exactly what a future frontmatter relaxation would feed it.
    const bare = { id: 'x', voice: 'elevenlabs:Ivan' } as VoiceDirection;
    const byCategory = applyRegister(bare, 'podcast');
    expect(byCategory).toEqual({
      id: 'x',
      register: 'host',
      voice: 'elevenlabs:Ivan',
      style: 'host',
      stylePrompt: REGISTERS.host.stylePrompt,
      settings: REGISTERS.host.settings,
    });
  });

  it('category default is suppressed by authored settings or stylePrompt', () => {
    expect(
      resolveRegisterSlug({ settings: { stability: 0.4 }, stylePrompt: undefined }, 'news'),
    ).toBeUndefined();
    expect(resolveRegisterSlug({ stylePrompt: 'Тихо.' }, 'news')).toBeUndefined();
    expect(resolveRegisterSlug({ style: 'creepy-whisper' }, 'stories')).toBeUndefined();
    expect(resolveRegisterSlug({}, 'stories')).toBe('narrator');
  });

  it('unknown or absent category → untouched (and prototype keys never match)', () => {
    const d = parse({ id: 'x', voice: 'elevenlabs:Ivan', style: 'neutral', deliveryNotes: 'n' });
    expect(applyRegister(d, 'radio-drama')).toEqual(d);
    expect(applyRegister(d)).toEqual(d);
    expect(resolveRegisterSlug({}, 'constructor')).toBeUndefined();
    expect(resolveRegisterSlug({}, 'radio-drama')).toBeUndefined();
  });

  it('keeps model / language / cues on a register direction', () => {
    const r = applyRegister(
      parse({
        id: 'x',
        register: 'narrator',
        model: 'eleven_v3',
        language: 'ru',
        audioTag: '[whispers]',
        contextCues: { s01: 'Тихо.' },
        sentenceVoices: { s02: 'elevenlabs:Other' },
      }),
    );
    expect(r.model).toBe('eleven_v3');
    expect(r.language).toBe('ru');
    expect(r.audioTag).toBe('[whispers]');
    expect(r.contextCues).toEqual({ s01: 'Тихо.' });
    expect(r.sentenceVoices).toEqual({ s02: 'elevenlabs:Other' });
    expect(r.voice).toBe(DEFAULT_VOICE);
  });

  it('throws on a hand-built direction with no register and no voice/style', () => {
    expect(() => applyRegister({ id: 'x' } as VoiceDirection)).toThrow(
      /voice and style are required/,
    );
  });
});
