import type { VoiceDirection, VoiceSettings } from './frontmatter.ts';

/**
 * Narration registers (M14, LIBRARY_CATEGORIES §2.5; ADR-0016): pipeline-only
 * presets that fill a voice direction's defaults — provider settings, the
 * `stylePrompt` sent as `previous_text`, the voice (`Mr. Wintrow`) and the
 * `style` label the app shows (the register slug itself, which T46 maps to a
 * Russian label: «Диктор», «Ведущий», …). Nothing new enters `pack.json`'s
 * shape: `AudioTrack.style` simply carries the slug.
 *
 * Presets are starting points; a family/anthology bible may pin tuned
 * settings after audition exactly as before — anything authored in the
 * draft's `voice:` block wins over the preset, field by field.
 */

export const REGISTER_SLUGS = [
  'narrator',
  'anchor',
  'lecturer',
  'host',
  'voiceover',
  'guide',
] as const;
export type RegisterSlug = (typeof REGISTER_SLUGS)[number];

/** Every settings knob a register pins (all five, so a preset is complete on its own). */
export type RegisterSettings = Required<VoiceSettings>;

export interface Register {
  /** Russian label the app shows for `AudioTrack.style === slug` (T46). */
  label: string;
  settings: RegisterSettings;
  /** Sent as `previous_text` on v2 — the narrator's "preceding lines", in Russian. */
  stylePrompt: string;
}

/** The default narration voice (ADR-0016): Mitch's professional clone on the new account. */
export const DEFAULT_VOICE = 'elevenlabs:Mr. Wintrow';

export const REGISTERS: Record<RegisterSlug, Register> = {
  // The CT011e v2 settings pinned in sumrak-content/series/no-end-house/
  // SERIES.md §5.6 (CT011e, 2026-09-19): "the clone's own defaults stability
  // 0.5 / style 0 / similarityBoost 0.75 / useSpeakerBoost true" — no speed
  // pinned there, so 1.00.
  narrator: {
    label: 'Рассказчик',
    settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true },
    stylePrompt:
      'Я рассказываю эту историю медленно, тихо, будто вспоминаю то, чего не хотел бы помнить.',
  },
  anchor: {
    label: 'Диктор',
    settings: {
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0.15,
      speed: 1.05,
      useSpeakerBoost: true,
    },
    stylePrompt: 'Добрый вечер. В эфире вечерний выпуск новостей. Коротко о главном.',
  },
  lecturer: {
    label: 'Лектор',
    settings: {
      stability: 0.65,
      similarityBoost: 0.8,
      style: 0.2,
      speed: 0.97,
      useSpeakerBoost: true,
    },
    stylePrompt:
      'Итак, продолжим лекцию. Сегодня мы разберём эту тему спокойно и по порядку. Обратите внимание на примеры.',
  },
  host: {
    label: 'Ведущий',
    settings: {
      stability: 0.35,
      similarityBoost: 0.75,
      style: 0.5,
      speed: 1.05,
      useSpeakerBoost: true,
    },
    stylePrompt:
      'Привет-привет! Вы слушаете наш подкаст. Устраивайтесь поудобнее — сегодня будет интересно, и я, честно говоря, сам не могу дождаться.',
  },
  voiceover: {
    label: 'Закадровый голос',
    settings: {
      stability: 0.6,
      similarityBoost: 0.8,
      style: 0.25,
      speed: 0.95,
      useSpeakerBoost: true,
    },
    stylePrompt:
      'Здесь, вдали от городов, природа живёт по своим законам. Каждый год здесь повторяется одна и та же история.',
  },
  guide: {
    label: 'Гид',
    settings: {
      stability: 0.4,
      similarityBoost: 0.75,
      style: 0.45,
      speed: 1.02,
      useSpeakerBoost: true,
    },
    stylePrompt:
      'Смотрите, мы только что приехали, и я вам сейчас всё покажу. Это место — одно из моих любимых.',
  },
};

/** Category → its default register (LIBRARY_CATEGORIES §2.5, "default for category"). */
export const CATEGORY_DEFAULT_REGISTER: Record<string, RegisterSlug> = {
  stories: 'narrator',
  news: 'anchor',
  education: 'lecturer',
  podcast: 'host',
  documentary: 'voiceover',
  travel: 'guide',
};

/** A voice direction after register resolution: `voice` and `style` are always present. */
export type ResolvedVoiceDirection = Omit<VoiceDirection, 'voice' | 'style'> & {
  voice: string;
  style: string;
};

/**
 * Resolve a direction's register (§2.5 precedence):
 *
 * 1. an explicit `register` → that preset;
 * 2. no `register`, but the pack's `category` has a default register AND the
 *    direction omits `settings`, `stylePrompt` and `style` → the category's
 *    preset (an old-style fully-authored direction is left exactly as written);
 * 3. otherwise the direction is returned as written — and since the schema
 *    then guarantees `voice`/`style`, the result is still fully resolved.
 *
 * Whenever a preset applies, authored fields win field by field: `voice`
 * (else `DEFAULT_VOICE`), `style` (else the slug), `stylePrompt` (else the
 * preset's), and `settings` **merge key-wise** — an authored `stability`
 * overrides only `stability`, the other four knobs still come from the
 * preset. `model`, `language`, cues and every other field pass through
 * untouched. Never emits `undefined` keys, so the result round-trips.
 */
export function applyRegister(
  direction: VoiceDirection,
  packCategory?: string,
): ResolvedVoiceDirection {
  const slug = resolveRegisterSlug(direction, packCategory);
  if (slug === undefined) {
    if (direction.voice === undefined || direction.style === undefined) {
      // Unreachable through VoiceDirectionSchema (its superRefine requires
      // both without a register); guard for callers building directions by hand.
      throw new Error(
        `track "${direction.id}": voice and style are required unless "register" is set`,
      );
    }
    return { ...direction, voice: direction.voice, style: direction.style };
  }
  const preset = REGISTERS[slug];
  const { register: _register, ...rest } = direction;
  return {
    ...rest,
    register: slug,
    voice: direction.voice ?? DEFAULT_VOICE,
    style: direction.style ?? slug,
    stylePrompt: direction.stylePrompt ?? preset.stylePrompt,
    settings: { ...preset.settings, ...direction.settings },
  };
}

/** Which register (if any) governs this direction — see {@link applyRegister}. */
export function resolveRegisterSlug(
  direction: Pick<VoiceDirection, 'register' | 'settings' | 'stylePrompt' | 'style'>,
  packCategory?: string,
): RegisterSlug | undefined {
  if (direction.register !== undefined) return direction.register;
  const byCategory =
    packCategory !== undefined && Object.hasOwn(CATEGORY_DEFAULT_REGISTER, packCategory)
      ? CATEGORY_DEFAULT_REGISTER[packCategory]
      : undefined;
  if (byCategory === undefined) return undefined;
  const authored =
    direction.settings !== undefined ||
    direction.stylePrompt !== undefined ||
    direction.style !== undefined;
  return authored ? undefined : byCategory;
}
