import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';

/**
 * The `.smb` media bundle format (T63, SPEAKING_SCENARIOS §10.3) — pure,
 * tested in Node:
 *
 *   'SMB1' (4 ASCII bytes) · u32 big-endian header length · UTF-8 JSON header
 *   `{ v: 1, runId, files: [{ name, bytes, sha256 }] }` · the file bodies
 *   concatenated in header order.
 *
 * The header carries only file NAMES (`t03-a2.ogg`) and sizes — never a
 * transcript, never Russian text — so a bundle name + header leak nothing
 * about what was said. Unpack verifies every body against its sha256 and
 * refuses the whole bundle on any mismatch.
 */

export const SMB_MAGIC = 'SMB1';
const MAGIC_BYTES = new Uint8Array([0x53, 0x4d, 0x42, 0x31]);
const HEADER_LEN_BYTES = 4;
/** A bundle header is small; refuse absurd lengths before allocating. */
const MAX_HEADER_BYTES = 1_000_000;

const FILE_NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

export const BundleFileSchema = z.strictObject({
  name: z.string().regex(FILE_NAME_RE),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BundleFile = z.infer<typeof BundleFileSchema>;

export const BundleHeaderSchema = z.strictObject({
  v: z.literal(1),
  runId: z.string().min(1).max(80),
  files: z.array(BundleFileSchema),
});
export type BundleHeader = z.infer<typeof BundleHeaderSchema>;

export class MediaBundleError extends Error {
  readonly code: 'bad-magic' | 'bad-header' | 'truncated' | 'sha-mismatch' | 'duplicate-name';
  constructor(code: MediaBundleError['code'], message: string) {
    super(message);
    this.name = 'MediaBundleError';
    this.code = code;
  }
}

export interface BundleInput {
  name: string;
  data: Uint8Array;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** Files → one `.smb` byte array. Names must be unique and header-safe. */
export function packMediaBundle(runId: string, files: readonly BundleInput[]): Uint8Array {
  const seen = new Set<string>();
  const entries: BundleFile[] = files.map((f) => {
    if (seen.has(f.name)) throw new MediaBundleError('duplicate-name', `duplicate ${f.name}`);
    seen.add(f.name);
    return { name: f.name, bytes: f.data.length, sha256: sha256Hex(f.data) };
  });
  const header: BundleHeader = BundleHeaderSchema.parse({ v: 1, runId, files: entries });
  const headerBytes = encoder.encode(JSON.stringify(header));
  const bodyBytes = files.reduce((s, f) => s + f.data.length, 0);
  const out = new Uint8Array(
    MAGIC_BYTES.length + HEADER_LEN_BYTES + headerBytes.length + bodyBytes,
  );
  let o = 0;
  out.set(MAGIC_BYTES, o);
  o += MAGIC_BYTES.length;
  new DataView(out.buffer, out.byteOffset).setUint32(o, headerBytes.length, false);
  o += HEADER_LEN_BYTES;
  out.set(headerBytes, o);
  o += headerBytes.length;
  for (const f of files) {
    out.set(f.data, o);
    o += f.data.length;
  }
  return out;
}

/** Just the header (cheap — no body hashing); throws on a malformed prefix. */
export function readMediaBundleHeader(bundle: Uint8Array): {
  header: BundleHeader;
  bodyOffset: number;
} {
  if (bundle.length < MAGIC_BYTES.length + HEADER_LEN_BYTES) {
    throw new MediaBundleError('truncated', 'bundle shorter than its fixed prefix');
  }
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (bundle[i] !== MAGIC_BYTES[i]) throw new MediaBundleError('bad-magic', 'not an SMB1 bundle');
  }
  const headerLen = new DataView(bundle.buffer, bundle.byteOffset).getUint32(
    MAGIC_BYTES.length,
    false,
  );
  if (headerLen > MAX_HEADER_BYTES) throw new MediaBundleError('bad-header', 'header too large');
  const start = MAGIC_BYTES.length + HEADER_LEN_BYTES;
  if (bundle.length < start + headerLen) {
    throw new MediaBundleError('truncated', 'bundle shorter than its header');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bundle.subarray(start, start + headerLen)));
  } catch {
    throw new MediaBundleError('bad-header', 'header is not JSON');
  }
  const parsed = BundleHeaderSchema.safeParse(raw);
  if (!parsed.success) throw new MediaBundleError('bad-header', 'header failed validation');
  return { header: parsed.data, bodyOffset: start + headerLen };
}

/** One `.smb` byte array → verified files. Any sha mismatch refuses the whole bundle. */
export function unpackMediaBundle(bundle: Uint8Array): {
  header: BundleHeader;
  files: BundleInput[];
} {
  const { header, bodyOffset } = readMediaBundleHeader(bundle);
  let o = bodyOffset;
  const files: BundleInput[] = [];
  for (const f of header.files) {
    if (o + f.bytes > bundle.length) {
      throw new MediaBundleError('truncated', `body of ${f.name} runs past the end`);
    }
    const data = bundle.subarray(o, o + f.bytes);
    if (sha256Hex(data) !== f.sha256) {
      throw new MediaBundleError('sha-mismatch', `${f.name} failed its checksum`);
    }
    files.push({ name: f.name, data });
    o += f.bytes;
  }
  return { header, files };
}
