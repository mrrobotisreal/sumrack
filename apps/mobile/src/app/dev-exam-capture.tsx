import { Directory, File, Paths } from 'expo-file-system';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hasApiKey } from '@/features/ai/config';
import { A2_CAPTURE_CASES } from '@/features/ai/dev/exam-a2-cases';
import { buildExamSpeakingMessages } from '@/features/ai/prompts/exam-speaking';
import { buildExamWritingMessages } from '@/features/ai/prompts/exam-writing';
import { getModelTable, resolveRun } from '@/features/ai/run-profile';
import { runChat } from '@/features/ai/runner';
import { parseExamGrade } from '@/features/ai/schemas';
import { criteriaPercent } from '@/features/torfl/grading/writing';
import { speakingCriteriaPercent } from '@/features/torfl/grading/speaking';

/**
 * DEV ONLY (T76) — captures the ten A2 exam-grading fixtures (five cases × Opus 5.5 @ high + GPT-6
 * Sol Pro @ high) THROUGH THE APP'S OWN AI PATH: Mitch's configured OpenRouter key (never read by an
 * agent), the run-profile table, `runChat`. Output JSON lands in `<documents>/a2-fixtures/` in the
 * committed fixture shape and is pulled with `run-as cat`. Writes nothing to the SQLite DB except the
 * ordinary `ai_request_*` analytics rows (restored with the pre-state DB).
 */
const MAX_TOKENS = { writing: 8_192, speaking: 6_144 } as const;
const PROFILES = [
  { tag: 'claude', provider: 'anthropic' as const },
  { tag: 'gpt', provider: 'openai' as const },
];

export default function DevExamCaptureScreen() {
  const [lines, setLines] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const log = (l: string) => setLines((p) => [...p, l]);

  const run = async (only?: string) => {
    if (!__DEV__ || busy) return;
    setBusy(true);
    try {
      if (!(await hasApiKey())) {
        log('no OpenRouter key on this device');
        return;
      }
      const dir = new Directory(Paths.document, 'a2-fixtures');
      if (!dir.exists) dir.create();
      const table = await getModelTable();
      for (const { tag, provider } of PROFILES) {
        const resolved = resolveRun({ provider, quality: 'normal', effort: 'high' }, table);
        for (const c of A2_CAPTURE_CASES) {
          const name = `exam-${c.kind === 'writing' ? 'writing' : 'speaking'}-${c.name}-${tag}`;
          if (only && !name.includes(only)) continue;
          log(`… ${name} (${resolved.model})`);
          const startedAt = Date.now();
          try {
            const messages =
              c.kind === 'writing'
                ? buildExamWritingMessages(c.input)
                : buildExamSpeakingMessages(c.input);
            const res = await runChat(
              c.kind === 'writing' ? 'exam-writing' : 'exam-speaking',
              {
                messages,
                maxTokens: c.kind === 'writing' ? MAX_TOKENS.writing : MAX_TOKENS.speaking,
                temperature: 0.2,
                timeoutMs: 240_000,
              },
              resolved,
            );
            const ms = Date.now() - startedAt;
            const grade = parseExamGrade(res.content);
            const pct = grade
              ? c.kind === 'writing'
                ? criteriaPercent(grade.criteria)
                : speakingCriteriaPercent(grade.criteria)
              : null;
            const fixture = {
              input: c.input,
              ms,
              model: res.model,
              choices: [
                { message: { content: res.content }, finish_reason: res.finishReason ?? null },
              ],
              usage: {
                prompt_tokens: res.usage?.promptTokens,
                completion_tokens: res.usage?.completionTokens,
                cost: res.usage?.costUsd,
                completion_tokens_details: { reasoning_tokens: res.usage?.reasoningTokens },
              },
            };
            const f = new File(dir, `${name}.json`);
            if (f.exists) f.delete();
            f.create();
            f.write(JSON.stringify(fixture, null, 2));
            log(
              `✓ ${name} pct=${pct ?? 'PARSE-FAIL'} cost=$${res.usage?.costUsd ?? '?'} ${Math.round(ms / 1000)}s`,
            );
          } catch (err) {
            log(`✗ ${name} ${String(err).slice(0, 120)}`);
          }
        }
      }
      log('done');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerClassName="gap-3 p-4" testID="dev-exam-capture">
      <Text className="font-ui-bold text-lg">A2 exam-grading fixture capture (dev)</Text>
      <Pressable
        onPress={() => void run()}
        disabled={busy}
        testID="capture-all"
        className="items-center rounded-full bg-accent px-5 py-3.5"
      >
        <Text className="font-ui-bold text-bg">{busy ? 'Running…' : 'Capture all 10'}</Text>
      </Pressable>
      <View className="gap-1">
        {lines.map((l, i) => (
          <Text key={i} variant="caption" testID={`capture-line-${i}`}>
            {l}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}
