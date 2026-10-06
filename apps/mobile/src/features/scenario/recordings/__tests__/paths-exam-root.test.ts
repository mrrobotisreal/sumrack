import { describe, expect, it, vi } from 'vitest';

import {
  EXAM_RECORDINGS_ROOT_SEGMENTS,
  RECORDINGS_ROOT_SEGMENTS,
  attemptFile,
  examRecordingName,
  listRunDirs,
  parseAttemptFileName,
  parseExamRecordingName,
  recordingsRoot,
  rootSegments,
  runDir,
  withExt,
} from '../paths';
import { createTranscodeQueue } from '../transcode-queue';

/**
 * T73 (TORFL §8.5): the recordings root parameter. Scenario paths are
 * byte-for-byte what T63 shipped (no argument ⇒ `recordings/scenario`);
 * the exam root lives beside it and the transcode queue routes a job's
 * rewrite by root.
 */

vi.mock('expo-file-system', () => {
  class FakeFile {
    constructor(
      public parent: FakeDir,
      public name: string,
    ) {}
    get uri() {
      return `${this.parent.uri}/${this.name}`;
    }
  }
  class FakeDir {
    parts: string[];
    constructor(base: string | FakeDir, ...rest: string[]) {
      this.parts = typeof base === 'string' ? [base, ...rest] : [...base.parts, ...rest];
    }
    get uri() {
      return this.parts.join('/');
    }
    get exists() {
      return false;
    }
    list(): never[] {
      return [];
    }
  }
  return { File: FakeFile, Directory: FakeDir, Paths: { document: 'file:///doc' } };
});
vi.mock('@/db', () => ({ repos: {} }));
vi.mock('@/features/pronunciation/opus-encoder', () => ({
  encodeWavToOpus: vi.fn(),
  isOpusUnsupported: () => false,
}));
vi.mock('@/services/error-log', () => ({ logError: vi.fn() }));

describe('recordings roots', () => {
  it('scenario is the default and unchanged; exam sits beside it', () => {
    expect(RECORDINGS_ROOT_SEGMENTS).toEqual(['recordings', 'scenario']);
    expect(EXAM_RECORDINGS_ROOT_SEGMENTS).toEqual(['recordings', 'exam']);
    expect(rootSegments('scenario')).toEqual(['recordings', 'scenario']);
    expect(rootSegments('exam')).toEqual(['recordings', 'exam']);
    expect(recordingsRoot().uri).toBe('file:///doc/recordings/scenario');
    expect(recordingsRoot('scenario').uri).toBe(recordingsRoot().uri);
    expect(recordingsRoot('exam').uri).toBe('file:///doc/recordings/exam');
  });

  it('run dir + attempt file: default = T63 layout; exam root under exam/<attemptId>/', () => {
    expect(runDir('run1').uri).toBe('file:///doc/recordings/scenario/run1');
    expect(attemptFile('run1', 't03-a2.ogg').uri).toBe(
      'file:///doc/recordings/scenario/run1/t03-a2.ogg',
    );
    expect(attemptFile('run1', 't03-a2.ogg', 'scenario').uri).toBe(
      attemptFile('run1', 't03-a2.ogg').uri,
    );
    expect(runDir('att1', 'exam').uri).toBe('file:///doc/recordings/exam/att1');
    expect(attemptFile('att1', 't1-sp01.wav', 'exam').uri).toBe(
      'file:///doc/recordings/exam/att1/t1-sp01.wav',
    );
    expect(listRunDirs()).toEqual([]);
    expect(listRunDirs('exam')).toEqual([]);
  });

  it('exam recording names: t<task>-<itemId>.<ext>, parsed back; never an attempt name', () => {
    expect(examRecordingName(1, 'sp01', 'wav')).toBe('t1-sp01.wav');
    expect(examRecordingName(3, 'sp03', 'ogg')).toBe('t3-sp03.ogg');
    expect(parseExamRecordingName('t2-sp02.ogg')).toEqual({ task: 2, itemId: 'sp02', ext: 'ogg' });
    expect(parseExamRecordingName('t4-sp02.ogg')).toBeNull();
    expect(parseExamRecordingName('t03-a2.ogg')).toBeNull();
    expect(parseAttemptFileName('t1-sp01.wav')).toBeNull();
    expect(withExt('t1-sp01.wav', 'ogg')).toBe('t1-sp01.ogg');
  });
});

describe('transcode queue by root', () => {
  function harness() {
    const fs = new Map<string, number>();
    const writes: { id: string; name: string; root: string }[] = [];
    const queue = createTranscodeQueue({
      encode: async (wav, out) => {
        fs.set(out, 1);
      },
      isUnsupported: () => false,
      setAudioFile: async (id, name, root) => {
        writes.push({ id, name, root });
      },
      fileExists: (uri) => fs.has(uri),
      fileSize: (uri) => fs.get(uri) ?? 0,
      deleteFile: (uri) => {
        fs.delete(uri);
      },
      filePath: (runId, name, root) => `${root}/${runId}/${name}`,
    });
    return { fs, writes, queue };
  }

  it('a job without a root is a scenario job (the T63 call sites are unchanged)', async () => {
    const h = harness();
    h.fs.set('scenario/r1/t00-a1.wav', 10);
    h.queue.enqueue({ runId: 'r1', attemptId: 'a1', wavName: 't00-a1.wav' });
    await h.queue.whenIdle('r1');
    expect(h.writes).toEqual([{ id: 'a1', name: 't00-a1.ogg', root: 'scenario' }]);
    expect(h.fs.has('scenario/r1/t00-a1.ogg')).toBe(true);
    expect(h.fs.has('scenario/r1/t00-a1.wav')).toBe(false);
  });

  it('an exam job encodes under exam/<attemptId>/ and rewrites by the exam root', async () => {
    const h = harness();
    h.fs.set('exam/att1/t1-sp01.wav', 10);
    h.queue.enqueue({ runId: 'att1', attemptId: 'resp1', wavName: 't1-sp01.wav', root: 'exam' });
    await h.queue.whenIdle('att1');
    expect(h.writes).toEqual([{ id: 'resp1', name: 't1-sp01.ogg', root: 'exam' }]);
    expect(h.fs.has('exam/att1/t1-sp01.ogg')).toBe(true);
    expect(h.fs.has('scenario/att1/t1-sp01.ogg')).toBe(false);
  });
});
