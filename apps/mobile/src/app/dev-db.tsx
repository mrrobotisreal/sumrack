import { useQueryClient } from '@tanstack/react-query';
import { sql } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { db, repos } from '@/db';
import { invalidateExams, queryKeys, usePacks, useStories, useTokenSearch } from '@/db/hooks';
import { importPack, removePack, type ImportResult } from '@/db/importer';
import type { ExamAttempt, ExamDeckCounts, ExamSummary } from '@/db/repositories/exams';
import type { ScenarioFamily, ScenarioRunRow } from '@/db/repositories/scenarios';
import type { WordProfileRow } from '@/db/repositories/word-forms';
import { friendlyAiMessage } from '@/features/ai/errors';
import {
  getDevForceEncoderUnsupported,
  resetTranscodeQueueForDev,
  setDevForceEncoderUnsupported,
} from '@/features/scenario/recordings/transcode-queue';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';
import {
  getGrammarPreset,
  PROVIDER_LABELS,
  QUALITY_LABELS,
  EFFORT_LABELS,
} from '@/features/ai/run-profile';
import { classifyPack } from '@/features/library/categories';
import { initialAttemptState, subtestItemCount } from '@/features/torfl/model';
import { itemPoints } from '@sumrak/schema';
import { generateProfile } from '@/features/word-forms/profile-service';
import { detectRuDatePath, formatRuDate } from '@/lib/ru-date';
import { syncQueryKeys } from '@/features/sync/hooks';
import { track } from '@/services/analytics';
import { requireOptionalNativeModule } from 'expo';
import { buildWidgetSnapshot } from '@/features/motivation/widget-snapshot';
import { refreshWidgetSnapshot } from '@/features/motivation/widget-sync';
import { previewRotation } from '@/features/motivation/quest-runtime';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * M14 test fixtures (T43) importable on demand from this dev-only screen
 * (T44) so T45/T46 can be verified on the S25 without publishing anything.
 * `require`d lazily inside the handler — the JSON never enters the bundle
 * graph outside this __DEV__ screen. Removal = the ordinary packs screen.
 */
const FIXTURE_PACKS = [
  { id: 'a2-news-090', note: 'news · 2 stories with subtitle + source' },
  { id: 'a2-podcast-090', note: 'podcast · 1 episode' },
  { id: 'a1-comedy-090', note: 'stories/comedy · 1 story, no source' },
  // T58 (M17): the T56 «Проверка связи» scenario — audio-less here (the
  // readout shows localUri null); T57's rendered copy lands via sync.
  { id: 'a1-scenario-fixture', note: 'scenario · radio-a1 · 6 turns · 15 glossary' },
  // T68 (M18): the T67 exam fixture — dev import only; «Delete exam fixture» below removes
  // it with every attempt/response/deck row that references it (device data hygiene).
  { id: 'a1-exam-fixture', note: 'exam · a1-mock-fx 5 subtests / 16 items · a1-drill-fx 6 items' },
  // T69 (M18): a 6-sentence `torfl:lexicon` story («bank a topic» on the S25) — never published;
  // «Delete exam fixture» removes it too (the words it banked are restored with the pre-DB).
  { id: 'a1-torfl-lexicon-fixture', note: 'stories/torfl · lx-fx-semya · torfl:lexicon' },
  // T74 (M18): four `torfl`-tagged journal prompts («Мои ответы» on the S25) — never published;
  // «Delete exam fixture» removes it too (entries written against it are restored with the pre-DB).
  { id: 'a1-torfl-prompts-fixture', note: 'prompts/torfl · 4 prompts · torfl:<topic>' },
  // T75 (M19): the A2 exam fixture — a2-mock-fx in the A2 shape at reduced counts (2 writing
  // parts, 10 lexgram, 5 read-match, 3 listening, 5 speaking) + 2 drills; dev import only, and
  // «Delete exam fixture» removes it with its attempts/cards (T75: the A2 fixtures go too).
  { id: 'a2-exam-fixture', note: 'exam · A2 · a2-mock-fx 5 subtests / 25 items · 2 drills' },
  // T75 (M19): two `torfl-a2` prompts («ТРКИ-А2: мои ответы» on the S25) — never published.
  { id: 'a2-torfl-prompts-fixture', note: 'prompts/torfl-a2 · 2 prompts · A2' },
  // T38: a 15-lemma `reference` pack (core-a1 10 + core-a2 5) — dev import only. A planted
  // files/packs/core-lemmas-fixture/pack.json (e.g. the real core-lemmas-001 before its
  // push) wins over the bundled copy, like the exam fixture.
  { id: 'core-lemmas-fixture', note: 'reference · core-a1 10 · core-a2 5 lemmas' },
] as const;
type FixtureId = (typeof FIXTURE_PACKS)[number]['id'];

const FIXTURE_JSON: Record<FixtureId, () => unknown> = {
  'a2-news-090': () => require('@sumrak/schema/fixtures/packs/a2-news-090/pack.json'),
  'a2-podcast-090': () => require('@sumrak/schema/fixtures/packs/a2-podcast-090/pack.json'),
  'a1-comedy-090': () => require('@sumrak/schema/fixtures/packs/a1-comedy-090/pack.json'),
  'a1-scenario-fixture': () =>
    require('@sumrak/schema/fixtures/packs/a1-scenario-fixture/pack.json'),
  'a1-exam-fixture': () => require('@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json'),
  'a1-torfl-lexicon-fixture': () =>
    require('@sumrak/schema/fixtures/packs/a1-torfl-lexicon-fixture/pack.json'),
  'a1-torfl-prompts-fixture': () =>
    require('@sumrak/schema/fixtures/packs/a1-torfl-prompts-fixture/pack.json'),
  'a2-exam-fixture': () => require('@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json'),
  'a2-torfl-prompts-fixture': () =>
    require('@sumrak/schema/fixtures/packs/a2-torfl-prompts-fixture/pack.json'),
  'core-lemmas-fixture': () =>
    require('@sumrak/schema/fixtures/packs/core-lemmas-fixture/pack.json'),
};

const EXAM_FIXTURE_ID = 'a1-exam-fixture';
const LEXICON_FIXTURE_ID = 'a1-torfl-lexicon-fixture';
const PROMPTS_FIXTURE_ID = 'a1-torfl-prompts-fixture';
// T75 (M19): the A2 exam + prompts fixtures.
const A2_EXAM_FIXTURE_ID = 'a2-exam-fixture';
const A2_PROMPTS_FIXTURE_ID = 'a2-torfl-prompts-fixture';

/** T68 dev readout: installed exams + the last 5 attempts + response counts + deck counts. */
interface ExamReadout {
  exams: ExamSummary[];
  attempts: ExamAttempt[];
  /** Per attempt id: responses by gradingStatus. */
  responses: Record<string, Record<string, number>>;
  deck: ExamDeckCounts;
}

/** «kind items/Σpts» per subtest — Σ = item points for objective subtests, maxPoints otherwise. */
function formatExam(e: ExamSummary): string {
  if (!e.exam) return `${e.packId}/${e.examId} · ${e.mode} · JSON UNREADABLE`;
  const subtests = e.exam.subtests.map((st) => {
    const items = st.parts.flatMap((p) => p.items);
    const objective = st.pointsPerItem !== undefined || items.some((i) => i.points !== undefined);
    const sum = objective ? items.reduce((n, i) => n + itemPoints(st, i), 0) : st.maxPoints;
    return `${st.kind} ${subtestItemCount(st)}/${sum}${objective ? '' : '%'}`;
  });
  const items = e.exam.subtests.reduce((n, st) => n + subtestItemCount(st), 0);
  const max = e.exam.subtests.reduce((n, st) => n + st.maxPoints, 0);
  return `${e.packId}/${e.examId} · ${e.mode} · ${e.exam.subtests.length} subtests · ${items} items · Σ maxPoints ${max} · ${subtests.join(' · ')}`;
}

function formatAttempt(a: ExamAttempt, responses: Record<string, number> | undefined): string {
  const when = new Date(a.startedAt).toISOString().slice(0, 16).replace('T', ' ');
  const results = a.results
    ? Object.entries(a.results)
        .map(([id, r]) => `${id} ${r.pct}%${r.provisional ? '*' : ''}`)
        .join(', ')
    : '—';
  const resp =
    responses && Object.keys(responses).length > 0
      ? Object.entries(responses)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ')
      : 'none';
  return `${when} · ${a.examId} · ${a.scope}/${a.mode} · ${a.status}${a.verdict ? ` → ${a.verdict}` : ''} · subtests ${a.subtestIds?.join(',') ?? '?'} · results ${results} · responses ${resp}${a.pinned ? ' · pinned' : ''}`;
}

/**
 * T03 debug screen — a verification surface, not product UI (real library
 * arrives in T04). Lists imported packs + stories straight from the
 * repositories and exposes an FTS search box. Only reachable from the
 * dev-only link on the Settings screen.
 */
/** T52 dev readout state: counts + the last 5 receipts, refreshed on focus and after a run. */
interface WordProfileReadout {
  profiles: { total: number; current: number; keys: number };
  lessons: number;
  withoutProfile: number;
  recent: WordProfileRow[];
}

/** T58 dev readout: installed scenarios (per rung: turns / glossary / audio staged / mouth) + the last 5 runs. */
interface ScenarioReadout {
  families: ScenarioFamily[];
  /** Per `packId/scenarioId`: audio rows, staged rows, rows with a mouth track, stamp rows, asset rows (staged). */
  perRung: Record<
    string,
    {
      audio: number;
      staged: number;
      mouth: number;
      stamps: number;
      assets: number;
      assetsStaged: number;
    }
  >;
  runs: ScenarioRunRow[];
}

/**
 * T58 dev-only: the on-device pack dir `documentDirectory/packs/<id>/` is
 * the same layout sync stages into. When a `pack.json` was planted there
 * (T57's rendered fixture pushed over adb) it is imported INSTEAD of the
 * bundled schema fixture; afterwards every audio row / scene layer whose
 * file exists in that dir gets its `localUri` set (a local "backfill" —
 * exactly what the Wi-Fi backfill does after a github download) and every
 * `scene/**` PNG on disk gets a `scenario_assets` row. Verification only.
 */
function packDir(packId: string): Directory {
  return new Directory(Paths.document, 'packs', packId);
}

function plantedPackJson(packId: string): unknown | null {
  const file = new File(packDir(packId), 'pack.json');
  if (!file.exists) return null;
  return JSON.parse(file.textSync()) as unknown;
}

async function backfillFromPackDir(packId: string): Promise<{ audio: number; scene: number }> {
  let audio = 0;
  for (const row of await repos.scenarios.listAudioForPack(packId)) {
    const f = new File(packDir(packId), ...row.file.split('/'));
    if (f.exists) {
      await repos.scenarios.setAudioLocalUri(packId, row.file, f.uri);
      audio += 1;
    }
  }
  let scene = 0;
  const sceneDir = new Directory(packDir(packId), 'scene');
  if (sceneDir.exists) {
    const walk = (dir: Directory, rel: string) => {
      for (const entry of dir.list()) {
        const name = entry.name;
        if (entry instanceof Directory) walk(entry, `${rel}${name}/`);
        else if (/\.png$/i.test(name)) {
          void repos.scenarios.setAssetLocalUri(packId, `${rel}${name}`, entry.uri, entry.size);
          scene += 1;
        }
      }
    };
    walk(sceneDir, 'scene/');
  }
  return { audio, scene };
}

function formatRun(r: ScenarioRunRow): string {
  const when = new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ');
  const state = r.finishedAt ? `finished → ${r.endingId ?? '?'}` : 'open';
  let stats = '';
  if (r.statsJson) {
    try {
      const s = JSON.parse(r.statsJson) as Record<string, unknown>;
      stats = ` · ${String(s.cleanTurns)}/${String(s.turns)} clean · ${String(s.misses)} misses · avg ${String(s.avgScore ?? '—')}`;
    } catch {
      stats = ' · stats unreadable';
    }
  }
  return `${when} · ${r.scenarioId} · ${state}${stats}${r.pinned ? ' · pinned' : ''}${r.mediaLocal ? '' : ' · media pruned'}${r.mediaBundleState ? ` · bundle ${r.mediaBundleState}` : ''}`;
}

function formatReceipt(r: WordProfileRow): string {
  const tokens = `${r.promptTokens ?? '?'}+${r.completionTokens ?? '?'}${
    r.reasoningTokens ? ` (r${r.reasoningTokens})` : ''
  } tok`;
  const cost = r.costUsd == null ? 'cost ?' : `$${r.costUsd.toFixed(4)}`;
  return `${r.headword} · ${r.pos} · ${r.provider} · ${r.model} · ${r.quality} · ${r.effort}${
    r.effortApplied ? '' : ' (effort n/a)'
  } · ${tokens} · ${cost} · ${(r.durationMs / 1000).toFixed(1)} s · ${r.isCurrent ? 'current' : 'old'}`;
}

export default function DevDbScreen() {
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  // --- T52 «Word profiles» readout ---------------------------------------
  const [readout, setReadout] = React.useState<WordProfileReadout | null>(null);
  const [profileLog, setProfileLog] = React.useState<string[]>([]);
  const [profileBusy, setProfileBusy] = React.useState(false);
  const refreshReadout = React.useCallback(async () => {
    const [profiles, lessons, withoutProfile, recent] = await Promise.all([
      repos.wordForms.countProfiles(),
      repos.wordForms.countLessons(),
      repos.wordForms.countItemsWithoutProfile(),
      repos.wordForms.listRecentProfiles(5),
    ]);
    setReadout({ profiles, lessons, withoutProfile, recent });
  }, []);
  const generateForNewest = React.useCallback(async () => {
    if (!__DEV__ || profileBusy) return;
    setProfileBusy(true);
    const log = (line: string) => setProfileLog((l) => [...l.slice(-11), line]);
    try {
      const [newest] = await repos.bank.listItems(
        { limit: 1 },
        { key: 'added-desc', familiarity: 'least' },
      );
      if (!newest) {
        log('bank is empty — add a word first');
        return;
      }
      const preset = await getGrammarPreset();
      log(
        `→ «${newest.kind === 'word' ? (newest.lemma ?? newest.surface) : newest.surface}» (${newest.kind}) with ${PROVIDER_LABELS[preset.provider]} / ${QUALITY_LABELS[preset.quality]} / ${EFFORT_LABELS[preset.effort]}…`,
      );
      const started = Date.now();
      const result = await generateProfile(newest, preset);
      log(
        `✓ ${result.profile.pos} · ${result.profile.sections.length} sections · ${((Date.now() - started) / 1000).toFixed(1)} s${result.corrected ? ' · corrected once' : ''} · row ${result.row.id}`,
      );
      log(
        result.warnings.length === 0
          ? 'soft warnings: none'
          : `soft warnings (${result.warnings.length}): ${result.warnings.slice(0, 6).join(' | ')}${result.warnings.length > 6 ? ' | …' : ''}`,
      );
      await refreshReadout();
    } catch (err) {
      log(`✗ ${friendlyAiMessage(err)}`);
    } finally {
      setProfileBusy(false);
    }
  }, [profileBusy, refreshReadout]);
  // --- T58 «Scenarios» readout ---------------------------------------------
  const [scenarioReadout, setScenarioReadout] = React.useState<ScenarioReadout | null>(null);
  const refreshScenarios = React.useCallback(async () => {
    const families = await repos.scenarios.listScenarios();
    const perRung: ScenarioReadout['perRung'] = {};
    for (const family of families) {
      for (const rung of family.rungs) {
        const detail = await repos.scenarios.getScenario(rung.packId, rung.id);
        const audioRows = Object.values(detail?.lines ?? {})
          .map((l) => l.audio)
          .filter((a): a is NonNullable<typeof a> => a !== null);
        let stamps = 0;
        for (const a of audioRows) {
          stamps += (await repos.scenarios.getStampsForSentence(rung.packId, a.sentenceId)).length;
        }
        perRung[`${rung.packId}/${rung.id}`] = {
          audio: audioRows.length,
          staged: audioRows.filter((a) => a.localUri !== null).length,
          mouth: audioRows.filter((a) => a.mouth !== null && a.mouth.length > 0).length,
          stamps,
          assets: detail?.assets.length ?? 0,
          assetsStaged: detail?.assets.filter((a) => a.localUri !== null).length ?? 0,
        };
      }
    }
    const runs = await repos.scenarios.listRuns(undefined, { limit: 5 });
    setScenarioReadout({ families, perRung, runs });
  }, []);
  // --- T68 «Exams» readout + dev actions ------------------------------------
  const [examReadout, setExamReadout] = React.useState<ExamReadout | null>(null);
  const [examLog, setExamLog] = React.useState<string | null>(null);
  const refreshExams = React.useCallback(async () => {
    const [examList, attempts, deck] = await Promise.all([
      repos.exams.listExams(),
      repos.exams.listAttempts({ limit: 5 }),
      repos.exams.deckCounts(),
    ]);
    const responses: ExamReadout['responses'] = {};
    for (const a of attempts) responses[a.id] = await repos.exams.countResponsesByStatus(a.id);
    setExamReadout({ exams: examList, attempts, responses, deck });
  }, []);
  /** Dev attempt on the fixture mock: start (refused while one is active) + one scored response. */
  const startDevAttempt = React.useCallback(async () => {
    if (!__DEV__) return;
    try {
      const exam = await repos.exams.getExam(EXAM_FIXTURE_ID, 'a1-mock-fx');
      if (!exam) {
        setExamLog('import a1-exam-fixture first');
        return;
      }
      const attempt = await repos.exams.startAttempt({
        packId: EXAM_FIXTURE_ID,
        examId: exam.id,
        scope: 'full',
        subtestIds: exam.subtests.map((st) => st.id),
        mode: exam.mode,
        state: initialAttemptState(exam.subtests),
      });
      await repos.exams.recordResponse({
        attemptId: attempt.id,
        subtestId: 'lexgram',
        itemId: 'lg01',
        answer: { kind: 'choice', index: 0 },
        points: 0,
        maxPoints: 1,
        gradingStatus: 'scored',
      });
      setExamLog(`started ${attempt.id} (active) + 1 response`);
    } catch (err) {
      setExamLog(`failed: ${String(err)}`);
    }
    await invalidateExams();
    await refreshExams();
  }, [refreshExams]);
  const abandonDevAttempt = React.useCallback(async () => {
    if (!__DEV__) return;
    try {
      const active = await repos.exams.getActiveAttempt();
      if (!active) {
        setExamLog('no active attempt');
        return;
      }
      if (active.packId !== EXAM_FIXTURE_ID) {
        setExamLog(`active attempt ${active.id} is not a fixture attempt — left alone`);
        return;
      }
      await repos.exams.abandonAttempt(active.id);
      setExamLog(`abandoned ${active.id}`);
    } catch (err) {
      setExamLog(`failed: ${String(err)}`);
    }
    await invalidateExams();
    await refreshExams();
  }, [refreshExams]);
  /**
   * Device data hygiene (CLAUDE.md, T66): remove the exam fixture COMPLETELY —
   * every attempt (responses cascade) + deck card that references it, the
   * pack + its content rows (cascade) + sync_state, and a staged pack dir.
   * T75: the A2 exam + A2 prompts fixtures go with it, their user rows too.
   */
  const deleteExamFixture = React.useCallback(async () => {
    if (!__DEV__) return;
    try {
      const user = await repos.exams.deleteUserRowsForPack(EXAM_FIXTURE_ID);
      const userA2 = await repos.exams.deleteUserRowsForPack(A2_EXAM_FIXTURE_ID);
      await removePack(db, EXAM_FIXTURE_ID);
      // T69: the lexicon fixture goes with it (pack + content + sync_state); T74: the prompts fixture too.
      await removePack(db, LEXICON_FIXTURE_ID);
      await removePack(db, PROMPTS_FIXTURE_ID);
      // T75: the A2 pair.
      await removePack(db, A2_EXAM_FIXTURE_ID);
      await removePack(db, A2_PROMPTS_FIXTURE_ID);
      let hadDir = false;
      for (const id of [
        EXAM_FIXTURE_ID,
        LEXICON_FIXTURE_ID,
        PROMPTS_FIXTURE_ID,
        A2_EXAM_FIXTURE_ID,
        A2_PROMPTS_FIXTURE_ID,
      ]) {
        const dir = packDir(id);
        if (dir.exists) {
          dir.delete();
          hadDir = true;
        }
      }
      setExamLog(
        `deleted fixtures: ${user.attempts + userA2.attempts} attempts (+ responses) · ${user.cards + userA2.cards} deck cards · 5 packs + content + sync_state${hadDir ? ' · staged dir' : ''}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
        queryClient.invalidateQueries({ queryKey: syncQueryKeys.installedPacks }),
        invalidateExams(),
      ]);
    } catch (err) {
      setExamLog(`failed: ${String(err)}`);
    }
    await refreshExams();
  }, [queryClient, refreshExams]);
  // --- T63 (dev only): plant N finished runs aged 31–40 days with fake recordings on disk,
  // then the prune matrix cell has something to delete (rows stay, files go).
  const [plantLog, setPlantLog] = React.useState<string | null>(null);
  const plantOldRuns = React.useCallback(async () => {
    if (!__DEV__) return;
    try {
      const families = await repos.scenarios.listScenarios();
      const rung = families[0]?.rungs[0];
      if (!rung) {
        setPlantLog('no scenario installed');
        return;
      }
      const detail = await repos.scenarios.getScenario(rung.packId, rung.id);
      const turn = detail?.turns.find((t) => t.expect) ?? detail?.turns[0];
      if (!detail || !turn) {
        setPlantLog('no turns');
        return;
      }
      const DAY = 86_400_000;
      let bytes = 0;
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const run = await repos.scenarios.startRun({
          packId: rung.packId,
          scenarioId: rung.id,
          familyId: rung.familyId,
          level: rung.level,
          startTurnId: detail.turns[0]!.id,
        });
        const attempt = await repos.scenarios.recordAttempt({
          runId: run.id,
          turnId: turn.id,
          kind: 'answer',
          outcome: 'matched',
          transcript: 'planted',
          detail: { kind: 'answer', target: 'planted', words: [], score: 100, slots: {} },
          audioDurationMs: 2000,
        });
        const dir = new Directory(Paths.document, 'recordings', 'scenario', run.id);
        dir.create({ intermediates: true });
        const name = `t${String(turn.orderIdx).padStart(2, '0')}-a${attempt.attemptNo}.ogg`;
        const f = new File(dir, name);
        f.write(new Uint8Array(20_000).fill(i + 1));
        bytes += 20_000;
        await repos.scenarios.setAttemptAudioFile(attempt.id, name);
        await repos.scenarios.finishRun(run.id, { endingId: detail.endings[0]!.id });
        const at = Date.now() - (31 + i) * DAY;
        await db.run(
          sql`UPDATE scenario_runs SET started_at = ${at - 60_000}, finished_at = ${at} WHERE id = ${run.id}`,
        );
        ids.push(run.id);
      }
      // Pin the first planted run so the «pin survives prune» cell has a subject.
      await repos.scenarios.setPinned(ids[0]!, true);
      setPlantLog(`planted 10 runs aged 31–40 d · ${bytes} B on disk · pinned ${ids[0]}`);
      await refreshScenarios();
    } catch (err) {
      setPlantLog(`failed: ${String(err)}`);
    }
  }, [refreshScenarios]);
  // --- T63 (dev only): the §12 «Opus encoder unsupported» switch — WAVs stay, bundles carry WAV.
  const [forceUnsupported, setForceUnsupported] = React.useState(getDevForceEncoderUnsupported);
  const toggleUnsupported = React.useCallback(() => {
    const next = !forceUnsupported;
    setDevForceEncoderUnsupported(next);
    if (!next) resetTranscodeQueueForDev();
    setForceUnsupported(next);
  }, [forceUnsupported]);
  // --- T58 backup self-check (dev only): export → restore the same payload.
  const [backupLog, setBackupLog] = React.useState<string | null>(null);
  // T34 quest: read-only rotation preview over injected day keys (writes nothing).
  const [questLog, setQuestLog] = React.useState<string | null>(null);
  const runQuestPreview = React.useCallback(async () => {
    try {
      const res = await previewRotation(7);
      setQuestLog(
        `available: ${res.available.join(', ') || '(none)'}\n` +
          res.days.map((d) => `${d.date} → ${d.kind ?? '(no quest)'}`).join('\n'),
      );
    } catch (err) {
      setQuestLog(`failed — ${String(err)}`);
    }
  }, []);
  // T40 widget: write the home-screen snapshot directly (demo every state on the device).
  const [widgetLog, setWidgetLog] = React.useState<string | null>(null);
  const writeWidget = React.useCallback((label: string, json: string | null) => {
    const native = requireOptionalNativeModule<{ writeSnapshot(j: string): void }>('SumrakWidget');
    if (!native) {
      setWidgetLog(`${label}: native module missing (rebuild the dev client)`);
      return;
    }
    try {
      native.writeSnapshot(json ?? '');
      setWidgetLog(`${label}: written`);
    } catch (err) {
      setWidgetLog(`${label}: failed — ${String(err)}`);
    }
  }, []);
  const writeWidgetNow = React.useCallback(() => {
    refreshWidgetSnapshot();
    setWidgetLog('Write snapshot now: refresh requested from live data');
  }, []);
  const writeWidgetStale = React.useCallback(() => {
    const snap = buildWidgetSnapshot({
      streak: 4,
      dueCount: 7,
      reviewsDone: 12,
      readingMs: 5 * 60_000,
      goal: { reviews: 20, readingMin: 10 },
      goalMet: false,
      continueReading: null,
      now: Date.now() - 48 * 3600_000,
    });
    writeWidget('Write stale snapshot (−48 h)', JSON.stringify(snap));
  }, [writeWidget]);
  const backupSelfCheck = React.useCallback(async () => {
    if (!__DEV__) return;
    try {
      const { payload } = await exportUserData(db);
      const t = payload.tables;
      const before = `export: scenarioRuns ${t.scenarioRuns.length} · scenarioAttempts ${t.scenarioAttempts.length} · examAttempts ${t.examAttempts.length} · examResponses ${t.examResponses.length} · examItemCards ${t.examItemCards.length} · keys ${Object.keys(t).length}`;
      const result = await restoreUserData(db, JSON.parse(JSON.stringify(payload)));
      const c = result.rowCounts;
      setBackupLog(
        `${before} → restore: scenarioRuns ${c.scenarioRuns} · scenarioAttempts ${c.scenarioAttempts} · examAttempts ${c.examAttempts} · examResponses ${c.examResponses} · examItemCards ${c.examItemCards} · total ${result.totalRows}`,
      );
      await refreshScenarios();
      await refreshExams();
    } catch (err) {
      setBackupLog(`failed: ${String(err)}`);
    }
  }, [refreshScenarios, refreshExams]);
  const packs = usePacks();
  const stories = useStories();
  const [query, setQuery] = React.useState('');
  const search = useTokenSearch(query);
  const [fixtureStatus, setFixtureStatus] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<FixtureId | null>(null);

  const importFixture = React.useCallback(
    async (id: FixtureId) => {
      if (!__DEV__ || busy) return;
      setBusy(id);
      try {
        // source 'bundled' (a legal PackSource, same as boot fixtures);
        // origin 'remote' is deliberate — the fixtures must go through the
        // T45 chip filter, not the «Импортировано» shelf.
        const planted = plantedPackJson(id);
        const result: ImportResult = await importPack(db, planted ?? FIXTURE_JSON[id](), {
          source: 'bundled',
          origin: 'remote',
        });
        let status = `${result.action} · v${result.version}${planted ? ' · from packs dir' : ''}`;
        if (result.counts.lemmas > 0)
          status += ` · ${result.packId} · ${result.counts.lemmas} lemmas`;
        if (result.counts.exams > 0) {
          // T70: a planted exam-fixture dir may carry listening audio (adb-pushed) — set each
          // track's localUri exactly as the Wi-Fi backfill would.
          let audio = 0;
          for (const row of await repos.content.listAudioTracksForPack(id)) {
            const f = new File(packDir(id), ...row.file.split('/'));
            if (f.exists) {
              await repos.content.setAudioLocalUri(id, row.file, f.uri);
              audio += 1;
            }
          }
          if (audio > 0) status += ` · backfilled ${audio} exam audio`;
        }
        if (result.counts.scenarios > 0) {
          const filled = await backfillFromPackDir(id);
          status += ` · backfilled ${filled.audio} audio / ${filled.scene} scene`;
        }
        setFixtureStatus((s) => ({ ...s, [id]: status }));
        track('debug_fixture_imported', { packId: id });
        if (result.counts.scenarios > 0 && result.action !== 'unchanged') {
          // §4.5 T58 event — one per scenario; slugs/numbers only.
          for (const family of await repos.scenarios.listScenarios()) {
            for (const rung of family.rungs.filter((r) => r.packId === id)) {
              track('scenario_pack_imported', {
                scenarioId: rung.id,
                turns: rung.turnCount,
                glossary: rung.glossaryCount,
              });
            }
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
          queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
          queryClient.invalidateQueries({ queryKey: queryKeys.scenarios }),
          queryClient.invalidateQueries({ queryKey: syncQueryKeys.installedPacks }),
          invalidateExams(),
        ]);
        await refreshScenarios();
        await refreshExams();
      } catch (err) {
        setFixtureStatus((s) => ({ ...s, [id]: `failed: ${String(err)}` }));
      } finally {
        setBusy(null);
      }
    },
    [busy, queryClient, refreshScenarios, refreshExams],
  );
  // Built-in FTS smoke test: known fixture lemma «стена» queried as "стена"
  // and ё-folded «чёрный» queried as "черный" — proves FTS5 MATCH works
  // on-device with ё/е tolerance without needing Cyrillic keyboard input.
  const selfTestWall = useTokenSearch('стена');
  const selfTestBlack = useTokenSearch('черный');

  useFocusEffect(
    React.useCallback(() => {
      track('debug_db_opened');
      void refreshReadout();
      void refreshScenarios();
      void refreshExams();
    }, [refreshReadout, refreshScenarios, refreshExams]),
  );

  return (
    <ScrollView className="flex-1 bg-bg px-4 pt-4" contentContainerClassName="pb-12 gap-6">
      {__DEV__ && (
        <View>
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Fixture packs (M14)
          </Text>
          <View className="gap-2">
            {FIXTURE_PACKS.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => void importFixture(f.id)}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={`Import fixture ${f.id}`}
                className={`rounded-xl border border-border p-3 ${
                  busy === f.id ? 'bg-surface-2' : 'bg-surface active:opacity-80'
                }`}
              >
                <Text className="font-ui-medium">
                  {busy === f.id ? 'Importing… ' : 'Import '}
                  {f.id}
                </Text>
                <Text variant="caption">
                  {f.note}
                  {fixtureStatus[f.id] ? ` · ${fixtureStatus[f.id]}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          {/* T45: which caption-date path this Hermes build takes (recorded in the ticket row). */}
          <Text variant="caption" className="mt-2">
            formatRuDate path: {detectRuDatePath()} · 2026-09-14 → {formatRuDate('2026-09-14')}
          </Text>
        </View>
      )}

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Word profiles (M16 · T52)
        </Text>
        <Text variant="caption">
          profiles:{' '}
          {readout
            ? `${readout.profiles.total} rows · ${readout.profiles.current} current · ${readout.profiles.keys} keys`
            : '…'}{' '}
          · lessons: {readout?.lessons ?? '…'} · bank items without a profile:{' '}
          {readout?.withoutProfile ?? '…'}
        </Text>
        {__DEV__ && (
          <Pressable
            onPress={() => void generateForNewest()}
            disabled={profileBusy}
            accessibilityRole="button"
            accessibilityLabel="Generate profile for the newest bank word"
            className={`mt-2 rounded-xl border border-border p-3 ${
              profileBusy ? 'bg-surface-2' : 'bg-surface active:opacity-80'
            }`}
          >
            <Text className="font-ui-medium">
              {profileBusy ? 'Generating…' : 'Generate for the newest bank word'}
            </Text>
            <Text variant="caption">
              Runs the T52 service with the Settings → AI «Grammar & word forms» preset; prints the
              validator&apos;s soft warnings.
            </Text>
          </Pressable>
        )}
        {profileLog.length > 0 && (
          <View className="mt-2 gap-1 rounded-xl bg-surface px-3 py-2">
            {profileLog.map((line, i) => (
              <Text key={`${i}-${line.slice(0, 12)}`} variant="caption" selectable>
                {line}
              </Text>
            ))}
          </View>
        )}
        <Text variant="caption" className="mt-2">
          Last 5 receipts
        </Text>
        <View className="mt-1 gap-1">
          {readout?.recent.map((r) => (
            <Text
              key={r.id}
              variant="caption"
              selectable
              className="rounded-lg bg-surface px-3 py-2"
            >
              {formatReceipt(r)}
            </Text>
          ))}
          {readout && readout.recent.length === 0 && (
            <Text variant="caption">No profiles yet.</Text>
          )}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Scenarios (M17 · T58)
        </Text>
        <View className="gap-2">
          {scenarioReadout?.families.flatMap((family) =>
            family.rungs.map((rung) => {
              const c = scenarioReadout.perRung[`${rung.packId}/${rung.id}`];
              return (
                <View
                  key={`${rung.packId}/${rung.id}`}
                  className="rounded-xl border border-border bg-surface p-3"
                >
                  <Text className="font-ui-medium">
                    {family.familyId} · {rung.level} · {rung.titleRu} · {rung.titleEn}
                  </Text>
                  <Text variant="caption" selectable>
                    {rung.packId}/{rung.id} · {rung.turnCount} turns · {rung.glossaryCount} glossary
                    · audio {c?.audio ?? '…'} rows / {c?.staged ?? '…'} staged (localUri) /{' '}
                    {c?.mouth ?? '…'} with mouth · {c?.stamps ?? '…'} stamps · assets{' '}
                    {c?.assets ?? '…'} rows / {c?.assetsStaged ?? '…'} staged ·{' '}
                    {rung.audioReady ? 'audio READY' : 'audio not ready'}
                  </Text>
                  <Text variant="caption">
                    runs: {rung.runCount} · last:{' '}
                    {rung.lastRun ? (rung.lastRun.finishedAt ? 'finished' : 'open') : '—'} · best:{' '}
                    {rung.bestStats
                      ? `${rung.bestStats.cleanTurns}/${rung.bestStats.turns} clean`
                      : '—'}
                  </Text>
                </View>
              );
            }),
          )}
          {scenarioReadout && scenarioReadout.families.length === 0 && (
            <Text variant="caption">
              No scenarios installed — import a1-scenario-fixture above.
            </Text>
          )}
        </View>
        {__DEV__ && (
          <Pressable
            onPress={toggleUnsupported}
            accessibilityRole="switch"
            accessibilityState={{ checked: forceUnsupported }}
            accessibilityLabel="Simulate no Opus encoder"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">
              Simulate no Opus encoder: {forceUnsupported ? 'ON' : 'off'}
            </Text>
            <Text variant="caption">
              Next attempts keep their WAV (opus_encode_failed unsupported); bundles carry WAV.
            </Text>
          </Pressable>
        )}
        {__DEV__ && (
          <Pressable
            onPress={() => void plantOldRuns()}
            accessibilityRole="button"
            accessibilityLabel="Plant 10 old runs"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Plant 10 old runs (T63 prune cell)</Text>
            <Text variant="caption" selectable>
              {plantLog ??
                'Ten finished runs aged 31–40 days, one 20 KB fake .ogg each, #1 pinned.'}
            </Text>
          </Pressable>
        )}
        {__DEV__ && <Text className="mt-4 font-ui-medium">Daily quest (T34)</Text>}
        {__DEV__ && (
          <Pressable
            onPress={() => void runQuestPreview()}
            accessibilityRole="button"
            accessibilityLabel="Quest rotation preview"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Quest rotation preview (7 days)</Text>
            <Text variant="caption" selectable>
              {questLog ??
                "Today's real availability → the next 7 day keys' picks. Read-only: writes no quest rows."}
            </Text>
          </Pressable>
        )}
        {__DEV__ && <Text className="mt-4 font-ui-medium">Widget (T40)</Text>}
        {__DEV__ && (
          <Pressable
            onPress={writeWidgetNow}
            accessibilityRole="button"
            accessibilityLabel="Write snapshot now"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Write snapshot now</Text>
            <Text variant="caption" selectable>
              Refreshes the snapshot from live data.
            </Text>
          </Pressable>
        )}
        {__DEV__ && (
          <Pressable
            onPress={writeWidgetStale}
            accessibilityRole="button"
            accessibilityLabel="Write stale snapshot (−48 h)"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Write stale snapshot (−48 h)</Text>
            <Text variant="caption" selectable>
              Stale state: numbers dim + «открой приложение».
            </Text>
          </Pressable>
        )}
        {__DEV__ && (
          <Pressable
            onPress={() => writeWidget('Write corrupt snapshot', '{"v":1,"streak":"oops"')}
            accessibilityRole="button"
            accessibilityLabel="Write corrupt snapshot"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Write corrupt snapshot</Text>
            <Text variant="caption" selectable>
              Malformed JSON: widget shows the fallback, never crashes.
            </Text>
          </Pressable>
        )}
        {__DEV__ && (
          <Pressable
            onPress={() => writeWidget('Clear snapshot', null)}
            accessibilityRole="button"
            accessibilityLabel="Clear snapshot"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Clear snapshot</Text>
            <Text variant="caption" selectable>
              Empty string → Missing: «Открой Сумрак» placeholder.
            </Text>
          </Pressable>
        )}
        {__DEV__ && widgetLog && (
          <Text variant="caption" selectable className="mt-1">
            {widgetLog}
          </Text>
        )}
        {__DEV__ && (
          <Pressable
            onPress={() => void backupSelfCheck()}
            accessibilityRole="button"
            accessibilityLabel="Backup payload self-check"
            className="mt-2 rounded-xl border border-border bg-surface p-3 active:opacity-80"
          >
            <Text className="font-ui-medium">Backup payload self-check</Text>
            <Text variant="caption" selectable>
              {backupLog ??
                'exportUserData → restoreUserData on this DB; prints the two M17 table counts.'}
            </Text>
          </Pressable>
        )}
        <Text variant="caption" className="mt-2">
          Last 5 runs
        </Text>
        <View className="mt-1 gap-1">
          {scenarioReadout?.runs.map((r) => (
            <Text
              key={r.id}
              variant="caption"
              selectable
              className="rounded-lg bg-surface px-3 py-2"
            >
              {formatRun(r)}
            </Text>
          ))}
          {scenarioReadout && scenarioReadout.runs.length === 0 && (
            <Text variant="caption">No runs yet.</Text>
          )}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Exams (M18 · T68)
        </Text>
        <View className="gap-2">
          {examReadout?.exams.map((e) => (
            <View
              key={`${e.packId}/${e.examId}`}
              className="rounded-xl border border-border bg-surface p-3"
            >
              <Text className="font-ui-medium">
                {e.titleRu} · {e.titleEn}
              </Text>
              <Text variant="caption" selectable>
                {formatExam(e)}
              </Text>
            </View>
          ))}
          {examReadout && examReadout.exams.length === 0 && (
            <Text variant="caption">No exams installed — import a1-exam-fixture above.</Text>
          )}
        </View>
        <Text variant="caption" className="mt-2" selectable>
          deck:{' '}
          {examReadout
            ? `${examReadout.deck.due} due · ${examReadout.deck.total} total · ${examReadout.deck.suspended} suspended · topics ${Object.keys(examReadout.deck.byTopic).length}`
            : '…'}
        </Text>
        {__DEV__ && (
          <View className="mt-2 gap-2">
            <Pressable
              onPress={() => void startDevAttempt()}
              accessibilityRole="button"
              accessibilityLabel="Start dev exam attempt"
              className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
            >
              <Text className="font-ui-medium">Start dev attempt (a1-mock-fx)</Text>
              <Text variant="caption">
                Active full-scope attempt + one scored lexgram response.
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void abandonDevAttempt()}
              accessibilityRole="button"
              accessibilityLabel="Abandon dev exam attempt"
              className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
            >
              <Text className="font-ui-medium">Abandon active dev attempt</Text>
              <Text variant="caption">Only touches an attempt on the fixture pack.</Text>
            </Pressable>
            <Pressable
              onPress={() => void deleteExamFixture()}
              accessibilityRole="button"
              accessibilityLabel="Delete exam fixture"
              className="rounded-xl border border-border bg-surface p-3 active:opacity-80"
            >
              <Text className="font-ui-medium">Delete exam fixture</Text>
              <Text variant="caption" selectable>
                {examLog ??
                  'Pack + content + sync_state + every fixture attempt/response/deck row (hygiene).'}
              </Text>
            </Pressable>
          </View>
        )}
        <Text variant="caption" className="mt-2">
          Last 5 attempts
        </Text>
        <View className="mt-1 gap-1">
          {examReadout?.attempts.map((a) => (
            <Text
              key={a.id}
              variant="caption"
              selectable
              className="rounded-lg bg-surface px-3 py-2"
            >
              {formatAttempt(a, examReadout.responses[a.id])}
            </Text>
          ))}
          {examReadout && examReadout.attempts.length === 0 && (
            <Text variant="caption">No attempts yet.</Text>
          )}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Imported packs ({packs.data?.length ?? '…'})
        </Text>
        <View className="gap-2">
          {packs.data?.map((p) => {
            const c = classifyPack(p);
            return (
              <View key={p.id} className="rounded-xl border border-border bg-surface p-3">
                <Text className="font-ui-medium">
                  {p.titleRu} · {p.titleEn}
                </Text>
                <Text variant="caption">
                  {p.id} · v{p.version} · {p.type} · {p.level} · {p.storyCount}{' '}
                  {p.storyCount === 1 ? 'story' : 'stories'}
                </Text>
                <Text variant="caption">tags: {p.tags.join(', ') || '—'}</Text>
                <Text variant="caption">
                  category: {p.category ?? 'NULL'} · genre: {p.genre ?? 'NULL'} → {c.category}/
                  {c.genre ?? '∅'}
                </Text>
              </View>
            );
          })}
          {packs.data?.length === 0 && (
            <Text variant="caption">No packs imported — bootstrap should have run.</Text>
          )}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Stories ({stories.data?.length ?? '…'})
        </Text>
        <View className="gap-2">
          {stories.data?.map((s) => (
            <View
              key={`${s.packId}/${s.id}`}
              className="rounded-xl border border-border bg-surface p-3"
            >
              <Text className="font-ui-medium">{s.titleRu}</Text>
              <Text variant="caption">
                {s.titleEn} · {s.level} · {s.sentenceCount} sentences · pack {s.packId}
              </Text>
              {(s.subtitleRu || s.sourceName) && (
                <Text variant="caption">
                  {s.subtitleRu ? `subtitle: ${s.subtitleRu} · ` : ''}
                  source: {s.sourceName ?? 'NULL'} · url: {s.sourceUrl ?? 'NULL'} · date:{' '}
                  {s.sourcePublishedAt ?? 'NULL'} · author: {s.sourceAuthor ?? 'NULL'}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>

      <View>
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          FTS5 token search (ё/е-tolerant)
        </Text>
        <Text variant="caption" className="mb-2">
          Self-test — «стена»: {selfTestWall.data ? `${selfTestWall.data.length} hits` : '…'} ·
          «черный»→ё: {selfTestBlack.data ? `${selfTestBlack.data.length} hits` : '…'}
          {selfTestBlack.data?.[0]?.lemma ? ` (lemma: ${selfTestBlack.data[0].lemma})` : ''}
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() =>
            query.trim() && track('debug_db_search', { chars: query.trim().length })
          }
          placeholder="Search lemma or surface form… (e.g. стена)"
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-base text-text"
        />
        <View className="mt-2 gap-1">
          {search.data?.slice(0, 20).map((hit) => (
            <View
              key={`${hit.packId}/${hit.sentenceId}/${hit.tokenIndex}`}
              className="flex-row items-baseline gap-2 rounded-lg bg-surface px-3 py-2"
            >
              <Text className="font-reading">{hit.text}</Text>
              <Text variant="caption">
                {hit.lemma ?? '—'} · {hit.translation ?? '—'} · {hit.pos ?? '—'} ·{' '}
                {hit.level ?? '—'} · {hit.sentenceId}
              </Text>
            </View>
          ))}
          {query.trim().length > 0 && search.data?.length === 0 && (
            <Text variant="caption">No matches.</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
