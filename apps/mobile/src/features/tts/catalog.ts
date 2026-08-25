import { z } from 'zod';

/**
 * The Piper Russian voice catalog (T11, design §6: "Ruslan, Irina, Denis,
 * Dmitri as available" — all four exist upstream as sherpa-onnx piper
 * archives; verified 2026-08-21).
 *
 * Sourcing (T23, V2 §2 — reverses the T11 hosting deviation): voices
 * install manifest-first from the content repo's `models/tts/` mirror
 * (resolved via `features/models/`), with the k2-fsa release-asset URL +
 * sha256 pinned below kept as the documented last-resort fallback — NOT
 * dead code. The sha256 of every archive is verified before install
 * whichever source served it; a pin test asserts both sources claim the
 * same hash per model id.
 */

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

export interface PiperVoice {
  /** Stable id used in settings, storage paths, analytics. */
  id: string;
  /** Human name for the Settings list. */
  displayName: string;
  /** One-line description (gender/flavor) for the list row. */
  description: string;
  archiveUrl: string;
  archiveSha256: string;
  archiveBytes: number;
  /** Top-level directory inside the archive (Piper convention). */
  dirName: string;
  /** Model filename inside dirName. */
  modelFile: string;
}

function piperVoice(
  name: string,
  displayName: string,
  description: string,
  archiveSha256: string,
  archiveBytes: number,
): PiperVoice {
  const dirName = `vits-piper-ru_RU-${name}-medium`;
  return {
    id: `piper-ru-${name}`,
    displayName,
    description,
    archiveUrl: `${RELEASE_BASE}/${dirName}.tar.bz2`,
    archiveSha256,
    archiveBytes,
    dirName,
    modelFile: `ru_RU-${name}-medium.onnx`,
  };
}

/** sha256/bytes pinned against the upstream assets on 2026-08-21. */
export const PIPER_VOICES: readonly PiperVoice[] = [
  piperVoice(
    'ruslan',
    'Руслан',
    'Male · clear, even delivery',
    '0690b1cad01f86e8db9ba988af24898bdc1af774e23cb2e46b9c730269b6fd83',
    67_210_684,
  ),
  piperVoice(
    'irina',
    'Ирина',
    'Female · soft, warm tone',
    '1fc0f54e5e084fe287c07909f2f6e0ba6d857864cf800e3ab80286a4e8233008',
    67_153_308,
  ),
  piperVoice(
    'denis',
    'Денис',
    'Male · deeper, deliberate pace',
    'efa4c18e0b5e32b81d1b6df36b9d312831e5d545200e27848ef926a4cd930300',
    67_190_991,
  ),
  piperVoice(
    'dmitri',
    'Дмитрий',
    'Male · brighter, faster cadence',
    'c86d0803737de13d441923ff3b3f309482fab8d7af3ec85949942809eb9a3660',
    67_188_551,
  ),
] as const;

export function getVoice(id: string): PiperVoice | undefined {
  return PIPER_VOICES.find((v) => v.id === id);
}

/** Sentinel voice id meaning "use the Android system TTS via expo-speech". */
export const SYSTEM_VOICE_ID = 'system';

/**
 * The persisted `tts.voice` settings value (standard DoD: Zod at the
 * settings I/O boundary). Unknown/absent → system fallback.
 */
export const ttsVoiceSettingSchema = z
  .strictObject({
    selectedVoiceId: z.string(),
  })
  .refine(
    (v) => v.selectedVoiceId === SYSTEM_VOICE_ID || getVoice(v.selectedVoiceId) !== undefined,
    { message: 'unknown voice id' },
  );

export type TtsVoiceSetting = z.infer<typeof ttsVoiceSettingSchema>;

/** Parse a stored settings value; anything invalid falls back to system TTS. */
export function parseTtsVoiceSetting(stored: unknown): TtsVoiceSetting {
  const parsed = ttsVoiceSettingSchema.safeParse(stored);
  return parsed.success ? parsed.data : { selectedVoiceId: SYSTEM_VOICE_ID };
}

/** "67.2 MB" style formatting for the Settings storage accounting. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}
