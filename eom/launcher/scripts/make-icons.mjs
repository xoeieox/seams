// Seams Launcher app icons - deterministic flame PNGs, zero deps (node:zlib only).
//   node eom/launcher/scripts/make-icons.mjs        # writes public/icons/*
// Honest minimal: a flame drawn from one implicit teardrop curve (a vertically
// flipped heart, sheared so the tip leans), four tonal bands whose palette comes
// straight from app.css design tokens (dark bar / warn / warm core / paper bg).
// No timestamps, no randomness: same bytes every run. 8-bit RGBA, filter-0 rows.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// ICONS_OUT overrides the destination (the test suite rebuilds into a temp dir and compares
// decoded pixels - the repo's public/icons/ must never be rewritten by a test).
const OUT = process.env.ICONS_OUT || path.join(here, '..', 'public', 'icons');

// palette (from app.css [data-theme=dark] --bar, warm flame steps, --bg paper)
const BG = [0x18, 0x19, 0x1b, 255];
const O = [0x7e, 0x4a, 0x1e, 255]; // outer flame (deep ember edge)
const B = [0xb5, 0x79, 0x3d, 255]; // body (design --warn family)
const Y = [0xdf, 0xa1, 0x5c, 255]; // inner flame
const W = [0xf2, 0xea, 0xd6, 255]; // core (paper glow)

// teardrop interior test, point up: (x^2+y^2-1)^3 + x^2*y^3 <= 0, sheared so the
// tip leans right and stretched to fill the frame; s scales the band, (dx,dy) shifts it.
function inside(u, v, s, dx = 0, dy = 0) {
  const x = (u - dx) / s;
  const y = (v - dy) / s;
  const t = x * x + y * y - 1;
  return t * t * t + x * x * y * y * y <= 0;
}
function flame(u, v) {
  // normalize: wide round base low, tapering tail up, tip sheared right;
  // U/V shrink leaves an honest margin so nothing clips at the icon edge.
  const U = u / 0.8;
  const V = (v + 0.1) / 0.88;
  const q = (U - 0.16 * Math.pow(Math.max(0, (V + 0.18) / 1.18), 2)) / 0.86;
  const w = (V + 0.18) / 1.12;
  if (inside(q, w, 1.0)) {
    if (inside(q, w, 0.22, 0.05, -0.34)) return W;
    if (inside(q, w, 0.48, 0.03, -0.16)) return Y;
    if (inside(q, w, 0.76, 0.015, -0.05)) return B;
    return O;
  }
  return null;
}
function pixel(x, y, size) {
  // 2x2 supersample for honest edges
  let acc = [0, 0, 0]; let cov = 0; let top = null;
  for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    const u = (x + ox) / size * 2 - 1;
    const v = 1 - (y + oy) / size * 2;
    const c = flame(u, v);
    cov += 0.25;
    if (c) { top = c; acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]]; }
  }
  if (!top) return BG;
  const a = cov;                     // coverage = alpha
  const n = cov / 0.25;              // how many samples hit flame
  return [
    Math.round(BG[0] * (1 - a) + (acc[0] / n) * a),
    Math.round(BG[1] * (1 - a) + (acc[1] / n) * a),
    Math.round(BG[2] * (1 - a) + (acc[2] / n) * a),
    255,
  ];
}

// ---- minimal PNG encoder (RGBA, no interlace) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, a] = pixel(x, y, size);
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return png(size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(OUT, name), makeIcon(size));
  console.log('wrote', name);
}
