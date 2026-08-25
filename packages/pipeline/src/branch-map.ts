import { analyzeDialogueGraph, type Choice, type Dialogue } from '@sumrak/schema';

/**
 * Branch map (T25, design V2 §3.2): a plain-text tree of a dialogue's graph
 * printed by `annotate`/`validate` so authors see the whole shape at a glance
 * — choice fan-out, where endings land, cycles, dead branches.
 *
 * This is an AUTHORING AID ONLY. Deterministic (declaration order) so it can
 * be snapshot-tested, but nothing downstream parses it — never make its
 * format load-bearing.
 */

/** A node's shortest-from-start depth past this is flagged as an outlier. */
const DEPTH_OUTLIER = 30;

const MAX_RU_PREVIEW = 40;

function preview(ru: string): string {
  return ru.length <= MAX_RU_PREVIEW ? ru : `${ru.slice(0, MAX_RU_PREVIEW - 1)}…`;
}

export function renderBranchMap(dialogue: Dialogue): string {
  const analysis = analyzeDialogueGraph(dialogue);
  const byId = new Map(dialogue.nodes.map((n) => [n.id, n]));
  const out: string[] = [];

  const choicePoints = dialogue.nodes.filter((n) => n.choices !== undefined).length;
  out.push(
    `Branch map — «${dialogue.title.ru}» (${dialogue.id}, ${dialogue.level})`,
    `  ${dialogue.nodes.length} nodes · ${choicePoints} choice point${choicePoints === 1 ? '' : 's'} · ` +
      `${dialogue.endings.length} ending${dialogue.endings.length === 1 ? '' : 's'} (${analysis.reachableEndings.length} reachable)`,
    '',
  );

  // --- tree -------------------------------------------------------------
  const shown = new Set<string>();
  const nodeLabel = (id: string): string => {
    const node = byId.get(id);
    if (!node) return `${id} (missing!)`;
    const ending = node.endingId !== undefined ? `  ⇒ ${node.endingId}` : '';
    return `${id} ${node.speakerId}: «${preview(node.sentence.ru)}»${ending}`;
  };

  const renderNode = (id: string, prefix: string, branch: string): void => {
    const childPrefix = prefix + (branch === '' ? '' : branch === '└─ ' ? '   ' : '│  ');
    if (shown.has(id)) {
      out.push(`${prefix}${branch}${id} ↩ (shown above)`);
      return;
    }
    shown.add(id);
    out.push(`${prefix}${branch}${nodeLabel(id)}`);
    const node = byId.get(id);
    if (!node) return;

    if (node.next !== undefined) {
      renderNode(node.next, childPrefix, '└─ ');
    } else if (node.choices !== undefined) {
      node.choices.forEach((choice: Choice, i: number) => {
        const last = i === node.choices!.length - 1;
        const choiceBranch = last ? '└─ ' : '├─ ';
        out.push(`${childPrefix}${choiceBranch}[${choice.id}] «${preview(choice.sentence.ru)}»`);
        renderNode(choice.next, childPrefix + (last ? '   ' : '│  '), '└─ ');
      });
    }
  };
  renderNode(dialogue.startNodeId, '', '');
  out.push('');

  // --- stats ------------------------------------------------------------
  const shortest = analysis.shortestPathNodes;
  const longest = analysis.longestPathNodes;
  out.push(
    `paths: ${
      shortest === null
        ? 'no path from the start reaches an ending'
        : `shortest ${shortest} nodes · longest ${analysis.longestPathCapped ? '≥' : ''}${longest} nodes` +
          (analysis.hasCycle ? ' (cycles not counted)' : '')
    }`,
  );
  out.push(
    `endings: ${dialogue.endings
      .map(
        (e) =>
          `${e.id} (${e.tone}) ${analysis.reachableEndings.includes(e.id) ? '✓' : '✗ UNREACHABLE'}`,
      )
      .join(' · ')}`,
  );

  // --- warnings ---------------------------------------------------------
  const warnings: string[] = [];
  for (const id of analysis.unreachable) {
    warnings.push(`node "${id}" is unreachable from the start — dead branch`);
  }
  for (const id of analysis.deadTraps) {
    warnings.push(`node "${id}" can never reach an ending — dead trap`);
  }
  for (const id of analysis.unreferencedEndings) {
    warnings.push(`ending "${id}" is never referenced by any node`);
  }
  if (analysis.hasCycle) {
    warnings.push('graph contains a cycle (allowed — every cycle here keeps an exit)');
  }
  // Depth outliers: nodes unusually far from the start (shortest distance).
  const depth = new Map<string, number>([[dialogue.startNodeId, 1]]);
  const queue = [dialogue.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    const targets =
      node.next !== undefined ? [node.next] : (node.choices?.map((c) => c.next) ?? []);
    for (const next of targets) {
      if (!depth.has(next) && byId.has(next)) {
        depth.set(next, depth.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  for (const node of dialogue.nodes) {
    const d = depth.get(node.id);
    if (d !== undefined && d > DEPTH_OUTLIER) {
      warnings.push(`node "${node.id}" sits ${d} nodes deep — depth outlier, consider splitting`);
    }
  }

  if (warnings.length > 0) {
    out.push('', `warnings (${warnings.length}):`);
    for (const w of warnings) out.push(`  ! ${w}`);
  }

  return out.join('\n');
}
