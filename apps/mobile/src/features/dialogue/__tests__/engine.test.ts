import { describe, expect, it } from 'vitest';

import { buildEngineState, endingById, nodeById, runPathStats } from '../engine';

import { graph, path } from './fixtures';

/**
 * Engine tests (T27): replaying pathJson against the T26 graph shape —
 * including the force-close resume cases the recorded resume-in-place
 * decision depends on. The fixture mirrors «Ужин у мамы» (a2-dialogue-001):
 * linear intro → choice point → loop-capable second choice → endings.
 */

describe('buildEngineState', () => {
  it('replays a fresh run: one node visited, no ending', () => {
    const state = buildEngineState(graph, path([{ nodeId: 'n1' }]));
    expect(state.status).toBe('active');
    expect(state.entries.map((e) => e.key)).toEqual(['step-0']);
    expect(state.current?.id).toBe('n1');
    expect(state.ending).toBeNull();
  });

  it('replays a mid-run path across a choice point (resume-in-place case)', () => {
    const state = buildEngineState(
      graph,
      path([{ nodeId: 'n1' }, { nodeId: 'n2', choiceId: 'c-yes', score: 92 }, { nodeId: 'n3' }]),
    );
    expect(state.status).toBe('active');
    expect(state.current?.id).toBe('n3');
    // Transcript: n1 line, n2 line, player answer, n3 line — in walk order.
    expect(
      state.entries.map((e) => (e.kind === 'node' ? e.node.id : `choice:${e.choice.id}`)),
    ).toEqual(['n1', 'n2', 'choice:c-yes', 'n3']);
    const choiceEntry = state.entries[2]!;
    expect(choiceEntry.kind === 'choice' && choiceEntry.score).toBe(92);
  });

  it('keeps tap-chosen answers scoreless in the transcript', () => {
    const state = buildEngineState(
      graph,
      path([{ nodeId: 'n1' }, { nodeId: 'n2', choiceId: 'c-no' }, { nodeId: 'n4' }]),
    );
    const entry = state.entries.find((e) => e.kind === 'choice');
    expect(entry && entry.kind === 'choice' ? entry.score : -1).toBeUndefined();
  });

  it('resolves the ending once the walk sits on an ending node', () => {
    const state = buildEngineState(
      graph,
      path([
        { nodeId: 'n1' },
        { nodeId: 'n2', choiceId: 'c-yes', score: 80 },
        { nodeId: 'n3' },
        { nodeId: 'n5' },
      ]),
    );
    expect(state.status).toBe('active'); // finish write is the caller's job
    expect(state.current?.id).toBe('n5');
    expect(state.ending?.id).toBe('end-good');
  });

  it('reports finished for a completed run', () => {
    const state = buildEngineState(
      graph,
      path([
        { nodeId: 'n1' },
        { nodeId: 'n2', choiceId: 'c-yes' },
        { nodeId: 'n3' },
        { nodeId: 'n5' },
      ]),
      { finished: true },
    );
    expect(state.status).toBe('finished');
    expect(state.ending?.id).toBe('end-good');
  });

  it('walks legal cycles without flinching (Ещё борща? loop)', () => {
    const state = buildEngineState(
      graph,
      path([
        { nodeId: 'n3' },
        { nodeId: 'n6', choiceId: 'c-more', score: 100 },
        { nodeId: 'n7' },
        { nodeId: 'n6', choiceId: 'c-more', score: 90 },
        { nodeId: 'n7' },
        { nodeId: 'n6' },
      ]),
    );
    expect(state.status).toBe('active');
    expect(state.current?.id).toBe('n6');
    expect(state.entries).toHaveLength(8); // 6 nodes + 2 answers
  });

  it('goes stale when a step names a node the installed graph lacks', () => {
    const state = buildEngineState(graph, path([{ nodeId: 'n1' }, { nodeId: 'gone' }]));
    expect(state.status).toBe('stale');
    expect(state.entries).toEqual([]);
    expect(state.current).toBeNull();
  });

  it('goes stale when a stamped choice no longer exists on its node', () => {
    const state = buildEngineState(
      graph,
      path([{ nodeId: 'n2', choiceId: 'gone-choice' }, { nodeId: 'n3' }]),
    );
    expect(state.status).toBe('stale');
  });

  it('goes stale when a choice is stamped on a non-choice node', () => {
    const state = buildEngineState(graph, path([{ nodeId: 'n1', choiceId: 'c-yes' }]));
    expect(state.status).toBe('stale');
  });

  it('goes stale on an empty path', () => {
    const state = buildEngineState(graph, path([]));
    expect(state.status).toBe('stale');
  });

  it('goes stale when a finished run’s ending no longer resolves', () => {
    const state = buildEngineState(graph, path([{ nodeId: 'n1' }]), { finished: true });
    expect(state.status).toBe('stale');
  });
});

describe('lookup helpers', () => {
  it('resolves nodes and endings by id', () => {
    expect(nodeById(graph, 'n2')?.kind).toBe('choices');
    expect(nodeById(graph, 'missing')).toBeUndefined();
    expect(endingById(graph, 'end-good')?.tone).toBe('good');
  });
});

describe('runPathStats', () => {
  it('derives choice/spoken/correct counts and the average score', () => {
    const stats = runPathStats(
      path([
        { nodeId: 'n1' },
        { nodeId: 'n2', choiceId: 'c-yes', score: 90 },
        { nodeId: 'n3' },
        { nodeId: 'n6', choiceId: 'c-more', score: 40 }, // spoken but sub-50
        { nodeId: 'n7' },
        { nodeId: 'n6', choiceId: 'c-stop' }, // tapped
        { nodeId: 'n5' },
      ]),
    );
    expect(stats.choiceCount).toBe(3);
    expect(stats.spokenCount).toBe(2);
    expect(stats.spokenCorrectCount).toBe(1);
    expect(stats.avgScore).toBe(65);
  });

  it('yields a null average when nothing was spoken', () => {
    const stats = runPathStats(path([{ nodeId: 'n1' }]));
    expect(stats.spokenCount).toBe(0);
    expect(stats.avgScore).toBeNull();
  });
});
