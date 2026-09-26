import {
  analyzeDialogueGraph,
  scenarioGraphInput,
  slotBranchKeys,
  type Choice,
  type Dialogue,
  type Scenario,
  type ScenarioTurn,
  type Slot,
} from '@sumrak/schema';

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

// ---------------------------------------------------------------------------
// Scenario branch map (T56, SCENARIOS §2.3): turns as nodes, an «expect»
// column (slots + branch keys), `on` edges labelled by key and a `default`
// edge. Same authoring-aid-only contract as the dialogue map above.
// ---------------------------------------------------------------------------

function slotSummary(slot: Slot): string {
  switch (slot.kind) {
    case 'forms': {
      const keys = slotBranchKeys(slot).join('|');
      return `${slot.id}${slot.required ? '' : '?'}: ${keys}`;
    }
    case 'number':
      return `${slot.id}${slot.required ? '' : '?'}: number`;
    case 'free':
      return `${slot.id}${slot.required ? '' : '?'}: free≥${slot.minTokens}`;
  }
}

/** The «expect» column for a turn: `[name: free≥1 · mood: good|bad|ok ⇢mood]` or `[monologue]`. */
export function expectColumn(turn: ScenarioTurn): string {
  if (turn.expect === undefined) return '[monologue]';
  const slots = turn.expect.slots.map(slotSummary).join(' · ');
  const branch = turn.expect.branchOn !== undefined ? ` ⇢${turn.expect.branchOn}` : '';
  const rejects = turn.expect.reject?.length ? ` ✗${turn.expect.reject.length}` : '';
  return `[${slots}${branch}${rejects}]`;
}

export function renderScenarioBranchMap(scenario: Scenario): string {
  const analysis = analyzeDialogueGraph(scenarioGraphInput(scenario));
  const byId = new Map(scenario.turns.map((t) => [t.id, t]));
  const out: string[] = [];

  const prompting = scenario.turns.filter((t) => t.expect !== undefined).length;
  const branchPoints = scenario.turns.filter((t) => typeof t.next === 'object').length;
  out.push(
    `Branch map — «${scenario.title.ru}» (${scenario.id}, ${scenario.level}, family ${scenario.familyId})`,
    `  ${scenario.turns.length} turns · ${prompting} prompting · ${branchPoints} branch point${branchPoints === 1 ? '' : 's'} · ` +
      `${scenario.endings.length} ending${scenario.endings.length === 1 ? '' : 's'} (${analysis.reachableEndings.length} reachable) · ` +
      `${scenario.glossary.length} glossary`,
    '',
  );

  const shown = new Set<string>();
  const turnLabel = (id: string): string => {
    const turn = byId.get(id);
    if (!turn) return `${id} (missing!)`;
    const prompt = turn.say[turn.say.length - 1]!.sentence.ru;
    const more = turn.say.length > 1 ? `(${turn.say.length} lines) ` : '';
    const ending = turn.endingId !== undefined ? `  ⇒ ${turn.endingId}` : '';
    return `${id} ${turn.speakerId}: ${more}«${preview(prompt)}» ${expectColumn(turn)}${ending}`;
  };

  const renderTurn = (id: string, prefix: string, branch: string): void => {
    const childPrefix = prefix + (branch === '' ? '' : branch === '└─ ' ? '   ' : '│  ');
    if (shown.has(id)) {
      out.push(`${prefix}${branch}${id} ↩ (shown above)`);
      return;
    }
    shown.add(id);
    out.push(`${prefix}${branch}${turnLabel(id)}`);
    const turn = byId.get(id);
    if (!turn) return;
    if (typeof turn.next === 'string') {
      renderTurn(turn.next, childPrefix, '└─ ');
    } else if (turn.next !== undefined) {
      const edges = [
        ...Object.entries(turn.next.on).map(([key, target]) => ({ label: key, target })),
        { label: 'default', target: turn.next.default },
      ];
      edges.forEach((edge, i) => {
        const last = i === edges.length - 1;
        const edgeBranch = last ? '└─ ' : '├─ ';
        out.push(
          `${childPrefix}${edgeBranch}${turn.expect?.branchOn ?? '?'}: ${edge.label} → ${edge.target}`,
        );
        renderTurn(edge.target, childPrefix + (last ? '   ' : '│  '), '└─ ');
      });
    }
  };
  renderTurn(scenario.startTurnId, '', '');
  out.push('');

  const shortest = analysis.shortestPathNodes;
  const longest = analysis.longestPathNodes;
  out.push(
    `paths: ${
      shortest === null
        ? 'no path from the start reaches an ending'
        : `shortest ${shortest} turns · longest ${analysis.longestPathCapped ? '≥' : ''}${longest} turns` +
          (analysis.hasCycle ? ' (cycles not counted)' : '')
    }`,
  );
  out.push(
    `endings: ${scenario.endings
      .map(
        (e) =>
          `${e.id} (${e.tone}) ${analysis.reachableEndings.includes(e.id) ? '✓' : '✗ UNREACHABLE'}`,
      )
      .join(' · ')}`,
  );

  const warnings: string[] = [];
  for (const id of analysis.unreachable) {
    warnings.push(`turn "${id}" is unreachable from the start — dead branch`);
  }
  for (const id of analysis.deadTraps) {
    warnings.push(`turn "${id}" can never reach an ending — dead trap`);
  }
  for (const id of analysis.unreferencedEndings) {
    warnings.push(`ending "${id}" is never referenced by any turn`);
  }
  if (analysis.hasCycle) {
    warnings.push('graph contains a cycle (allowed — every cycle here keeps an exit)');
  }
  if (warnings.length > 0) {
    out.push('', `warnings (${warnings.length}):`);
    for (const w of warnings) out.push(`  ! ${w}`);
  }
  return out.join('\n');
}
