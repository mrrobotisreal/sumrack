import { describe, expect, it } from 'vitest';

import {
  appendEntry,
  describeError,
  emptyLog,
  parseLogFile,
  serializeLog,
  type ErrorLogEntry,
} from '../error-log-core';

const entry = (over: Partial<ErrorLogEntry> = {}): ErrorLogEntry => ({
  ts: 1700000000000,
  scope: 'manual',
  message: 'boom',
  ...over,
});

describe('appendEntry', () => {
  it('appends oldest-first', () => {
    const log = appendEntry(
      appendEntry(emptyLog(), entry({ message: 'a' })),
      entry({ message: 'b' }),
    );
    expect(log.entries.map((e) => e.message)).toEqual(['a', 'b']);
  });

  it('trims to the cap, dropping oldest', () => {
    let log = emptyLog();
    for (let i = 0; i < 7; i++) log = appendEntry(log, entry({ message: `e${i}` }), 5);
    expect(log.entries).toHaveLength(5);
    expect(log.entries[0]!.message).toBe('e2');
    expect(log.entries[4]!.message).toBe('e6');
  });
});

describe('parseLogFile', () => {
  it('round-trips a serialized log', () => {
    const log = appendEntry(emptyLog(), entry({ stack: 'at x', fatal: true }));
    expect(parseLogFile(serializeLog(log))).toEqual(log);
  });

  it('degrades invalid JSON to empty', () => {
    expect(parseLogFile('{not json').entries).toEqual([]);
  });

  it('degrades schema drift to empty', () => {
    expect(parseLogFile(JSON.stringify({ v: 99, entries: 'nope' })).entries).toEqual([]);
    expect(
      parseLogFile(JSON.stringify({ v: 1, entries: [{ ts: -1, scope: 'render', message: 'x' }] }))
        .entries,
    ).toEqual([]);
  });
});

describe('describeError', () => {
  it('unwraps Error instances', () => {
    const err = new Error('bad');
    const d = describeError(err);
    expect(d.message).toBe('bad');
    expect(d.stack).toBe(err.stack);
  });

  it('handles strings, objects, and unserializable values', () => {
    expect(describeError('plain').message).toBe('plain');
    expect(describeError({ code: 7 }).message).toBe('{"code":7}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeError(cyclic).message).toBe('[object Object]');
  });
});
