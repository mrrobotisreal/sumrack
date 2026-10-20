import { useQuery } from '@tanstack/react-query';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { repos } from '@/db';
import { isHeldOut } from '@/features/learning-evidence/aliases';
import { resolveContinueTarget } from '@/features/reader/continue-target';
import { getExamDate } from '@/features/torfl/settings';
import { catalog } from '@/features/listening-lab/catalog';
import { resolveSegment } from '@/features/listening-lab/source';
import { CompletionSchema, COMPLETE_MODE, parsePlan, PLAN_MODE, type Completion } from './model';

export const planKey = ['daily-plan'] as const;
export function usePlanData() {
  return useQuery({
    queryKey: planKey,
    queryFn: async () => {
      const [plans, completions, due, packs, stories, progress, scenarios, permission, examDate] =
        await Promise.all([
          repos.learningSessions.list(PLAN_MODE, 10000),
          repos.learningSessions.list(COMPLETE_MODE, 10000),
          repos.reviews.countDueBreakdown(),
          repos.content.listPacks(),
          repos.content.listStories(),
          repos.reading.listProgress(),
          repos.scenarios.listScenarios(),
          getRecordingPermissionsAsync().catch(() => ({ granted: false })),
          getExamDate(),
        ]);
      const readablePacks = packs.filter(
        (p) => (p.type === 'stories' || p.type === 'course-unit') && !isHeldOut(p.id),
      );
      const readable = stories.filter(
        (s) => readablePacks.some((p) => p.id === s.packId) && s.sentenceCount > 0,
      );
      const target =
        resolveContinueTarget(progress, readable) ??
        (readable[0] ? { packId: readable[0].packId, storyId: readable[0].id } : null);
      const listenHrefs: string[] = [];
      const fileExists = (uri: string) => {
        try {
          return new File(uri).exists;
        } catch {
          return false;
        }
      };
      // The small companion catalog is checked only against already installed versions.
      // Cache shared story/track reads and stop at the first playable exercise.
      const details = new Map<string, Awaited<ReturnType<typeof repos.content.getStoryDetail>>>();
      const stampsByTrack = new Map<
        string,
        Awaited<ReturnType<typeof repos.content.getWordStamps>>
      >();
      for (const segment of catalog.segments) {
        const source = segment.source;
        if (!packs.some((p) => p.id === source.packId && p.version === source.packVersion))
          continue;
        const key = `${source.packId}:${source.storyId}`;
        if (!details.has(key))
          details.set(key, await repos.content.getStoryDetail(source.packId, source.storyId));
        const detail = details.get(key) ?? null;
        if (!detail) continue;
        const trackKey = `${key}:${source.trackId}`;
        if (!stampsByTrack.has(trackKey))
          stampsByTrack.set(
            trackKey,
            await repos.content.getWordStamps(source.packId, source.storyId, source.trackId),
          );
        if (
          resolveSegment(segment, detail, stampsByTrack.get(trackKey) ?? [], fileExists).available
        ) {
          listenHrefs.push(`/listening-lab/${segment.id}`);
          break;
        }
      }
      if (listenHrefs.length === 0) {
        const availability = await repos.listen.listListenAvailability(
          readablePacks.map((p) => p.id),
        );
        for (const p of readablePacks) {
          if (availability.get(p.id)?.state !== 'ready') continue;
          const source = await repos.listen.getListenSource(p.id);
          if (source?.uri && fileExists(source.uri)) {
            listenHrefs.push(`/listen/${p.id}`);
            break;
          }
        }
      }
      const speaking = scenarios
        .flatMap((f) => f.rungs)
        .filter((r) => r.audioReady && r.level === 'A1');
      const history: Completion[] = completions.flatMap((row) => {
        const d = CompletionSchema.safeParse(row.detail);
        return d.success && row.endedAt !== null
          ? [{ ...d.data, id: row.id, at: row.endedAt }]
          : [];
      });
      return {
        plans: plans.flatMap((row) => {
          const detail = parsePlan(row.detail);
          return detail ? [{ id: row.id, at: row.startedAt, detail }] : [];
        }),
        history,
        dueCount: due.total,
        microphoneAvailable: permission.granted,
        examDate,
        readingHref: target ? `/reader/${target.packId}/${target.storyId}` : null,
        listeningHref: listenHrefs[0] ?? null,
        speakingHref: speaking[0] ? `/scenario/${speaking[0].packId}/${speaking[0].id}` : null,
        allowedHrefs: new Set([
          '/review/daily',
          '/learning-evidence',
          '/journal/new',
          '/learning-evidence/location-destination',
          '/learning-evidence/dative-verbs',
          '/learning-evidence/adjective-agreement',
          ...readable.map((s) => `/reader/${s.packId}/${s.id}`),
          ...listenHrefs,
          ...speaking.map((r) => `/scenario/${r.packId}/${r.id}`),
        ]),
      };
    },
  });
}
