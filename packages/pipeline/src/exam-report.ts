import {
  itemPoints,
  OBJECTIVE_SUBTEST_KINDS,
  officialShapeIssues,
  resolveItemAudio,
  type Exam,
  type Pack,
  type StoryRef,
} from '@sumrak/schema';
import { EXAM_TOPIC_KIND } from './exam-topics.ts';

/**
 * The four `validate` / `annotate` reports for an exam (T67, TORFL §3.3):
 * matrix map, topic census, official-shape check, ref table.
 *
 * AUTHORING AIDS ONLY — deterministic (declaration order) so they can be
 * snapshot-tested, but nothing downstream parses them. Warnings here never
 * change an exit code; schema errors (which stop a pack before it gets here)
 * do.
 */

const fmt = (n: number) => String(+n.toFixed(3));

/** Matrix map: subtest → parts → items with kind / topic / points; Σ vs maxPoints. */
export function renderMatrixMap(exam: Exam): string {
  const out: string[] = [];
  const itemCount = exam.subtests.reduce(
    (n, s) => n + s.parts.reduce((m, p) => m + p.items.length, 0),
    0,
  );
  out.push(
    `Matrix map — «${exam.title.ru}» (${exam.id}, ${exam.format} ${exam.level} ${exam.mode})`,
    `  ${exam.subtests.length} subtest${exam.subtests.length === 1 ? '' : 's'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`,
  );
  for (const subtest of exam.subtests) {
    const objective = OBJECTIVE_SUBTEST_KINDS.includes(subtest.kind);
    const extras = [
      `${subtest.durationMin} min`,
      subtest.dictionary ? 'dictionary' : 'no dictionary',
      subtest.navigation,
      subtest.audioPlays !== undefined ? `audio ×${subtest.audioPlays}` : null,
    ].filter((x): x is string => x !== null);
    let total = 0;
    const body: string[] = [];
    for (const part of subtest.parts) {
      body.push(
        `    ${part.id} (${part.items.length} item${part.items.length === 1 ? '' : 's'}${part.timeSec !== undefined ? `, ${part.timeSec} s` : ''})`,
      );
      for (const item of part.items) {
        const pts = objective ? itemPoints(subtest, item) : undefined;
        if (pts !== undefined) total += pts;
        const extra =
          item.kind === 'speaking-monologue' && item.group !== undefined
            ? ` group ${item.group}`
            : '';
        body.push(
          `      ${item.id.padEnd(8)} ${item.kind.padEnd(18)} ${item.topic.padEnd(16)} ${pts !== undefined ? `${fmt(pts)} pt` : 'rubric'}${extra}`,
        );
      }
    }
    const sum = objective
      ? `Σ ${fmt(total)} / ${fmt(subtest.maxPoints)} ${Math.abs(total - subtest.maxPoints) <= 0.001 ? '✓' : '✗'}`
      : `rubric % of ${fmt(subtest.maxPoints)}`;
    out.push(
      '',
      `  ${subtest.id} — ${subtest.kind} «${subtest.title.ru}» · ${extras.join(' · ')} · ${sum}`,
      ...body,
    );
  }
  return out.join('\n');
}

/** Topic census: items per topic slug; slugs outside TORFL §3.4 (or under another subtest kind) flagged. */
export function renderTopicCensus(exam: Exam): string {
  const counts = new Map<string, { n: number; kinds: Set<string> }>();
  for (const subtest of exam.subtests) {
    for (const part of subtest.parts) {
      for (const item of part.items) {
        const c = counts.get(item.topic) ?? { n: 0, kinds: new Set<string>() };
        c.n += 1;
        c.kinds.add(subtest.kind);
        counts.set(item.topic, c);
      }
    }
  }
  const out = [`Topic census — ${exam.id} (${counts.size} topic${counts.size === 1 ? '' : 's'})`];
  for (const [topic, { n, kinds }] of counts) {
    const known = EXAM_TOPIC_KIND.get(topic);
    const where = [...kinds].join(', ');
    const flag =
      known === undefined
        ? '?  (not a TORFL §3.4 slug — renders raw in the app)'
        : kinds.size === 1 && kinds.has(known)
          ? ''
          : `?  (§3.4 lists it under ${known})`;
    out.push(`  ${topic.padEnd(16)} ${String(n).padStart(3)}  ${where}${flag ? `  ${flag}` : ''}`);
  }
  return out.join('\n');
}

/** Official-shape check: the non-fatal invariant-10 lines, or the ✓ line. */
export function renderOfficialShape(exam: Exam): string {
  if (exam.mode !== 'mock' || exam.format !== 'torfl' || exam.level !== 'A1') {
    return `Official shape — ${exam.id}: not checked (${exam.mode}, ${exam.format} ${exam.level} — only A1 TORFL mocks are)`;
  }
  const lines = officialShapeIssues(exam);
  return lines.length === 0
    ? `Official shape — ${exam.id}: ✓ official shape (TORFL A1 mock)`
    : [
        `Official shape — ${exam.id}: ${lines.length} deviation${lines.length === 1 ? '' : 's'}`,
        ...lines.map((l) => `  ${l}`),
      ].join('\n');
}

/** Ref table: every story ref (+ inherited listening audio) → story / track / sentence span, ✓/✗. */
export function renderRefTable(exam: Exam, pack: Pack): { text: string; broken: number } {
  const stories = new Map(pack.stories.map((s) => [s.id, s]));
  const rows: string[] = [];
  let broken = 0;
  const describe = (ref: StoryRef): { ok: boolean; text: string } => {
    const story = stories.get(ref.storyId);
    if (!story) return { ok: false, text: `${ref.storyId} — unknown story` };
    const problems: string[] = [];
    let span = `all ${story.sentences.length} sentence${story.sentences.length === 1 ? '' : 's'}`;
    if (ref.sentenceIds) {
      const idx = ref.sentenceIds.map((id) => story.sentences.findIndex((s) => s.id === id));
      const contiguous = idx.every((v, k) => v >= 0 && (k === 0 || v === idx[k - 1]! + 1));
      if (!contiguous) problems.push('span not contiguous / unknown sentence');
      span =
        ref.sentenceIds.length === 1
          ? ref.sentenceIds[0]!
          : `${ref.sentenceIds[0]}…${ref.sentenceIds[ref.sentenceIds.length - 1]} (${ref.sentenceIds.length})`;
    }
    let track = story.audio[0]?.id ?? 'no audio';
    if (ref.trackId !== undefined) {
      track = ref.trackId;
      if (!story.audio.some((t) => t.id === ref.trackId))
        problems.push(`no track "${ref.trackId}"`);
    }
    const ok = problems.length === 0;
    return { ok, text: `${story.id} · ${span} · ${track}${ok ? '' : ` — ${problems.join('; ')}`}` };
  };
  for (const subtest of exam.subtests) {
    for (const part of subtest.parts) {
      part.items.forEach((item, ii) => {
        const refs: [string, StoryRef | undefined, boolean][] = [];
        if (item.kind === 'choice' || item.kind === 'typed') {
          refs.push(['passage', item.passage, false]);
          const own = item.audio;
          const resolved = resolveItemAudio(part, ii);
          refs.push(['audio', resolved, own === undefined && resolved !== undefined]);
        } else if (item.kind === 'writing' || item.kind === 'speaking-monologue') {
          refs.push(['model', item.model, false]);
        } else {
          refs.push(['prompt', item.prompt, false]);
        }
        for (const [field, ref, inherited] of refs) {
          if (ref === undefined) continue;
          const d = describe(ref);
          if (!d.ok) broken += 1;
          rows.push(
            `  ${d.ok ? '✓' : '✗'} ${`${subtest.id}/${item.id}`.padEnd(20)} ${(inherited ? `${field}↑` : field).padEnd(8)} → ${d.text}`,
          );
        }
      });
    }
  }
  const head = `Ref table — ${exam.id} (${rows.length} ref${rows.length === 1 ? '' : 's'}${broken > 0 ? `, ${broken} broken` : ', all ✓'}${rows.some((r) => r.includes('↑')) ? '; ↑ = inherited from the part’s first item' : ''})`;
  return { text: [head, ...(rows.length > 0 ? rows : ['  (no story refs)'])].join('\n'), broken };
}

/** All four reports for every exam of a pack, separated by blank lines. */
export function renderExamReports(pack: Pack): string[] {
  return (pack.exams ?? []).map((exam) =>
    [
      renderMatrixMap(exam),
      renderTopicCensus(exam),
      renderOfficialShape(exam),
      renderRefTable(exam, pack).text,
    ].join('\n\n'),
  );
}
