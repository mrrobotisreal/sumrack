import { describe, expect, it } from 'vitest';

import {
  BundleHeaderSchema,
  MediaBundleError,
  packMediaBundle,
  readMediaBundleHeader,
  sha256Hex,
  SMB_MAGIC,
  unpackMediaBundle,
} from '../media-bundle';

/** T63 §10.3: the `.smb` format — pack/unpack round trip, sha per file, refusals. */

const bytes = (...n: number[]) => new Uint8Array(n);

describe('media bundle format (SMB1)', () => {
  it('starts with the magic, a big-endian header length, and the JSON header', () => {
    const b = packMediaBundle('run-1', [{ name: 't00-a1.ogg', data: bytes(1, 2, 3) }]);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe(SMB_MAGIC);
    const len = new DataView(b.buffer, b.byteOffset).getUint32(4, false);
    const header = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + len)));
    expect(BundleHeaderSchema.parse(header)).toEqual({
      v: 1,
      runId: 'run-1',
      files: [{ name: 't00-a1.ogg', bytes: 3, sha256: sha256Hex(bytes(1, 2, 3)) }],
    });
    expect(b.length).toBe(8 + len + 3);
  });

  it('round-trips several files in order, bodies byte-exact', () => {
    const files = [
      { name: 't01-a1.ogg', data: bytes(9, 8, 7, 6) },
      { name: 't01-a2.wav', data: new Uint8Array(0) },
      { name: 't02-a1.ogg', data: new Uint8Array(1000).fill(0xab) },
    ];
    const { header, files: out } = unpackMediaBundle(packMediaBundle('run-2', files));
    expect(header.runId).toBe('run-2');
    expect(out.map((f) => f.name)).toEqual(files.map((f) => f.name));
    out.forEach((f, i) => expect(Array.from(f.data)).toEqual(Array.from(files[i]!.data)));
  });

  it('readMediaBundleHeader is cheap and does not hash the bodies', () => {
    const b = packMediaBundle('run-3', [{ name: 'a.ogg', data: bytes(1) }]);
    b[b.length - 1] = 2; // corrupt the body
    expect(readMediaBundleHeader(b).header.files[0]!.name).toBe('a.ogg');
    expect(() => unpackMediaBundle(b)).toThrowError(
      expect.objectContaining({ code: 'sha-mismatch' }),
    );
  });

  it('refuses a wrong magic, a truncated body, and a non-JSON header', () => {
    const b = packMediaBundle('run-4', [{ name: 'a.ogg', data: bytes(1, 2, 3, 4) }]);
    const wrong = new Uint8Array(b);
    wrong[0] = 0x58;
    expect(() => unpackMediaBundle(wrong)).toThrowError(
      expect.objectContaining({ code: 'bad-magic' }),
    );
    expect(() => unpackMediaBundle(b.subarray(0, b.length - 2))).toThrowError(
      expect.objectContaining({ code: 'truncated' }),
    );
    const garbage = new Uint8Array(b);
    garbage[8] = 0x7b + 1; // break the JSON's first byte
    expect(() => unpackMediaBundle(garbage)).toThrowError(
      expect.objectContaining({ code: 'bad-header' }),
    );
    expect(() => unpackMediaBundle(bytes(1, 2))).toThrowError(
      expect.objectContaining({ code: 'truncated' }),
    );
  });

  it('rejects duplicate names and header-unsafe names at pack time', () => {
    expect(() =>
      packMediaBundle('run-5', [
        { name: 'a.ogg', data: bytes(1) },
        { name: 'a.ogg', data: bytes(2) },
      ]),
    ).toThrowError(MediaBundleError);
    expect(() => packMediaBundle('run-5', [{ name: '../a.ogg', data: bytes(1) }])).toThrow();
    expect(() => packMediaBundle('run-5', [{ name: 'Меня зовут.ogg', data: bytes(1) }])).toThrow();
  });

  it('the header carries names and sizes only — no transcript can ride along', () => {
    const keys = Object.keys(BundleHeaderSchema.shape);
    expect(keys.sort()).toEqual(['files', 'runId', 'v']);
    expect(
      BundleHeaderSchema.safeParse({
        v: 1,
        runId: 'r',
        files: [{ name: 'a.ogg', bytes: 1, sha256: 'a'.repeat(64), transcript: 'x' }],
      }).success,
    ).toBe(false);
  });
});
