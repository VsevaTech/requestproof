#!/usr/bin/env node
'use strict';
/**
 * Generates extension/icons/icon{16,48,128}.png deterministically with no
 * dependencies (rounded blue square + white check mark). Idempotent: existing
 * byte-identical files are left untouched. Used by CI so the repository never
 * depends on hand-made binaries.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'extension', 'icons');
const BLUE = [43, 92, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- tiny anti-aliased rasteriser (4x4 supersampling) ---
function insideRoundedRect(x, y, s, r) {
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function render(size) {
  const s = size;
  const radius = s * 0.18;
  const stroke = Math.max(1, s / 9) / 2;
  const pts = [
    [s * 0.24, s * 0.52],
    [s * 0.43, s * 0.71],
    [s * 0.77, s * 0.32]
  ];
  const rgba = Buffer.alloc(s * s * 4);
  const SS = 4;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!insideRoundedRect(px, py, s, radius)) continue;
          bg++;
          const d = Math.min(distToSegment(px, py, ...pts[0], ...pts[1]), distToSegment(px, py, ...pts[1], ...pts[2]));
          if (d <= stroke) fg++;
        }
      }
      const a = bg / (SS * SS);
      const f = bg ? fg / bg : 0;
      const o = (y * s + x) * 4;
      rgba[o] = Math.round(BLUE[0] + (255 - BLUE[0]) * f);
      rgba[o + 1] = Math.round(BLUE[1] + (255 - BLUE[1]) * f);
      rgba[o + 2] = Math.round(BLUE[2] + (255 - BLUE[2]) * f);
      rgba[o + 3] = Math.round(255 * a);
    }
  }
  return encodePng(s, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
let changed = 0;
for (const size of [16, 48, 128]) {
  const file = path.join(OUT, `icon${size}.png`);
  const png = render(size);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(png)) continue;
  fs.writeFileSync(file, png);
  changed++;
  console.log(`wrote ${path.relative(process.cwd(), file)} (${png.length} bytes)`);
}
console.log(changed ? `${changed} icon(s) generated` : 'icons up to date');
