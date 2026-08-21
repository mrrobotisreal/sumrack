/**
 * Generates assets/textures/grain.png — a small tileable monochrome noise
 * texture used by the story header treatment (design §10: "subtle
 * grain/vignette on story headers"). Committed output; rerun only to retune:
 *
 *   node scripts/gen-grain.mjs
 *
 * The PNG is grayscale+alpha: white speckles at random low alpha, so it can
 * be tinted/dimmed purely via style opacity and works over any surface.
 * No deps — PNG chunks are written by hand via node:zlib.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 128;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Raw image: grayscale + alpha (color type 4), 8-bit, one filter byte per row.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 2));
let off = 0;
for (let y = 0; y < SIZE; y++) {
  raw[off++] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    raw[off++] = 255; // white
    // Sparse speckle: most pixels fully transparent, a few at faint alpha.
    const r = Math.random();
    raw[off++] = r < 0.55 ? 0 : Math.floor((r - 0.55) * (255 / 0.45) * 0.35);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 4; // grayscale + alpha
// compression/filter/interlace = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '../assets/textures/grain.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
