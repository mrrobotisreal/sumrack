import * as Speech from 'expo-speech';

import { hasApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import {
  buildScenarioExplainMessages,
  buildScenarioHowToSayMessages,
  parseHelpLine,
} from '@/features/ai/prompts/scenario-help';
import { getGrammarPreset, getModelTable, resolveRun } from '@/features/ai/run-profile';
import { runChat } from '@/features/ai/runner';
import { speakWithInfo, stopSpeaking } from '@/features/tts/service';

import { RESCUE_TIMEOUT_MS } from './judge/rescue';

/**
 * The суфлёр (T60, SPEAKING_SCENARIOS §1.2 / §6): the in-fiction prompter
 * voice for dynamic answers the pack could not pre-render. Russian through
 * the T11 chain (Piper when the selected voice is installed, else the
 * system voice); the English word through `expo-speech` en-US. Nothing
 * here decides anything — the resolvers in meta-intents.ts do; this only
 * speaks and fetches the two online one-liners.
 */

/** Speak Russian through the T11 fallback chain; resolves when playback has started. */
export async function speakRu(text: string, rate = 1): Promise<void> {
  await speakWithInfo(text, { rate });
}

/** Speak one English word/phrase in en-US; resolves when it is DONE (it precedes/follows Russian). */
export function speakEn(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      Speech.speak(text, {
        language: 'en-US',
        rate: 0.9,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

/** «„{ru}“ — это {en}»: Russian, then the English word in its own voice (§6 explain, bare-token hit). */
export async function speakGloss(ru: string, en: string): Promise<void> {
  await speakRu(`${ru} — это`);
  await waitForRu();
  await speakEn(en);
}

/** «{en} — по-русски „{ru}“» (§6 howtosay, online fallback). */
export async function speakHowToSay(en: string | null, ru: string): Promise<void> {
  if (en) {
    await speakEn(en);
    await speakRu(`по-русски: ${ru}`);
  } else {
    await speakRu(ru);
  }
}

export async function stopPrompter(): Promise<void> {
  await stopSpeaking();
  Speech.stop();
}

/**
 * The T11 chain resolves when playback STARTS. For the RU → EN sequence
 * we poll the store's speaking flags (Piper + system) until quiet, capped.
 */
async function waitForRu(maxMs = 6000): Promise<void> {
  const { useTtsStore } = await import('@/features/tts/store');
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 150));
  while (Date.now() - started < maxMs) {
    const s = useTtsStore.getState();
    if (!s.speaking && !s.systemSpeaking) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function helpAllowed(): Promise<boolean> {
  const [online, key] = await Promise.all([isOnline(), hasApiKey()]);
  return online && key;
}

/** Online «что значит X» one-liner (English gloss), null when offline / no key / failed / unknown. */
export async function fetchExplainLine(query: string): Promise<string | null> {
  if (!(await helpAllowed())) return null;
  try {
    const [preset, table] = await Promise.all([getGrammarPreset(), getModelTable()]);
    const result = await runChat(
      'scenario-explain',
      {
        messages: buildScenarioExplainMessages(query),
        maxTokens: 60,
        temperature: 0,
        timeoutMs: RESCUE_TIMEOUT_MS,
      },
      resolveRun({ provider: preset.provider, quality: 'fastest', effort: 'low' }, table),
    );
    return parseHelpLine(result.content);
  } catch {
    return null;
  }
}

/** Online «как сказать X» one-liner (spoken Russian), null when offline / no key / failed / unknown. */
export async function fetchHowToSayLine(query: string): Promise<string | null> {
  if (!(await helpAllowed())) return null;
  try {
    const [preset, table] = await Promise.all([getGrammarPreset(), getModelTable()]);
    const result = await runChat(
      'scenario-howtosay',
      {
        messages: buildScenarioHowToSayMessages(query),
        maxTokens: 60,
        temperature: 0,
        timeoutMs: RESCUE_TIMEOUT_MS,
      },
      resolveRun({ provider: preset.provider, quality: 'fastest', effort: 'low' }, table),
    );
    const line = parseHelpLine(result.content);
    // Cyrillic only — a model that answered in English is "unknown" to the суфлёр.
    return line && /\p{Script=Cyrillic}/u.test(line) ? line : null;
  } catch {
    return null;
  }
}
