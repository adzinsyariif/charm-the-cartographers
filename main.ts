// Charm the Cartographers — a treasure map of an island that does not exist.
// Pure TypeScript, zero dependencies: a tiny software rasterizer draws the map
// onto an RGB framebuffer and a small PNG encoder writes /output/entry.png.
// Run with: node main.ts   (Node >= 22.6)
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xC0FFEE);

// ---------------------------------------------------------------------------
// Framebuffer
// ---------------------------------------------------------------------------
type RGB = [number, number, number];
const fb = new Uint8Array(W * H * 3);

function px(x: number, y: number, c: RGB, a = 1): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  if (a >= 1) {
    fb[i] = c[0];
    fb[i + 1] = c[1];
    fb[i + 2] = c[2];
  } else {
    fb[i] = Math.round(fb[i] * (1 - a) + c[0] * a);
    fb[i + 1] = Math.round(fb[i + 1] * (1 - a) + c[1] * a);
    fb[i + 2] = Math.round(fb[i + 2] * (1 - a) + c[2] * a);
  }
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(W - 1, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H - 1, Math.ceil(y + h));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) px(xx, yy, c, a);
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) px(x, y, c, a);
    }
  }
}

function line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len * 1.2));
  const r = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, r, c, a);
  }
}

function polyline(pts: Array<[number, number]>, w: number, c: RGB, closed = false, a = 1): void {
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    line(p[0], p[1], q[0], q[1], w, c, a);
  }
}

function fillPoly(pts: Array<[number, number]>, c: RGB, a = 1): void {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) {
        const t = (y - p[1]) / (q[1] - p[1]);
        xs.push(p[0] + t * (q[0] - p[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) px(x, y, c, a);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c, a);
    }
  }
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, w: number, c: RGB, a = 1): void {
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r));
  let px0 = cx + r * Math.cos(a0);
  let py0 = cy + r * Math.sin(a0);
  for (let i = 1; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    line(px0, py0, x, y, w, c, a);
    px0 = x;
    py0 = y;
  }
}

// Dashed line following a polyline, dash/gap in px.
function dashed(pts: Array<[number, number]>, w: number, c: RGB, dash = 9, gap = 7): void {
  let carry = 0; // distance into current dash/gap cycle; < dash means drawing
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(len);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      if (carry < dash) {
        disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c);
      }
      carry += len / steps;
      if (carry >= dash + gap) carry -= dash + gap;
    }
  }
}

// A gentle sine wiggle between two points (rivers, coast squiggles).
function wiggly(x0: number, y0: number, x1: number, y1: number, amp: number, waves: number, w: number, c: RGB, a = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.ceil(len);
  let px0 = x0;
  let py0 = y0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * Math.PI * 2 * waves) * amp;
    const x = x0 + dx * t + nx * off;
    const y = y0 + dy * t + ny * off;
    line(px0, py0, x, y, w, c, a);
    px0 = x;
    py0 = y;
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (rows are strings of 0/1, left to right, top to bottom)
// ---------------------------------------------------------------------------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10001", "10000", "10001", "01110"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11110", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  j: ["00010", "00000", "00110", "00010", "00010", "10010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "00000", "11110", "10001", "10001", "11110", "10000"],
  q: ["00000", "00000", "01111", "10001", "10001", "01111", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11100", "01000", "01000", "01000", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  w: ["00000", "00000", "10001", "10101", "10101", "10101", "01010"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "~": ["00000", "00000", "01001", "10110", "00000", "00000", "00000"],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB, a = 1): void {
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row[col] === "1") {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              px(cx + col * scale + dx, cy + r * scale + dy, c, a);
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB, a = 1): void {
  drawText(s, cx - textWidth(s, scale) / 2, y, scale, c, a);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const INK: RGB = [58, 42, 26];
const INK_SOFT: RGB = [94, 70, 44];
const RED: RGB = [163, 59, 46];
const BLUE: RGB = [74, 107, 122];
const GREEN: RGB = [96, 110, 66];
const SAND: RGB = [224, 205, 150];
const PARCH: RGB = [232, 213, 168];
const PARCH_DARK: RGB = [201, 168, 106];
const SEA_TINT: RGB = [168, 196, 184];
const WHITE: RGB = [244, 238, 222];

// ---------------------------------------------------------------------------
// Smooth value noise for parchment blotches
// ---------------------------------------------------------------------------
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x: number, y: number): number {
  return vnoise(x, y) * 0.6 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.1;
}

// ---------------------------------------------------------------------------
// Island outline: a closed wobbly blob via a sum of sines (periodic, smooth)
// ---------------------------------------------------------------------------
const ISLE_CX = 500;
const ISLE_CY = 585;
const ISLE_RX = 330;
const ISLE_RY = 268;
const WOBBLE: Array<[number, number, number]> = [
  [1, 0.1, 0.7],
  [2, 0.14, 2.1],
  [3, 0.07, 4.4],
  [5, 0.05, 1.2],
];
function islandPoint(t: number, scale: number): [number, number] {
  let r = 1;
  for (const [k, amp, ph] of WOBBLE) r += amp * Math.sin(k * t + ph);
  // a bay on the south-east side (Crabapple Cove) and a notch north-west
  r -= 0.16 * Math.exp(-Math.pow((t - 0.85) / 0.22, 2));
  r -= 0.1 * Math.exp(-Math.pow((t - 3.6) / 0.2, 2));
  return [ISLE_CX + Math.cos(t) * ISLE_RX * r * scale, ISLE_CY + Math.sin(t) * ISLE_RY * r * scale];
}
function islandPoly(n: number, scale: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) pts.push(islandPoint((i / n) * Math.PI * 2, scale));
  return pts;
}

// ---------------------------------------------------------------------------
// PNG encoder (RGB, adaptive per-row filter, zlib level 9)
// ---------------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let table = (crc32 as unknown as { t?: Int32Array }).t;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t: Int32Array }).t = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const bpp = 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  const prev = Buffer.alloc(w * bpp);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * w * bpp, (y + 1) * w * bpp);
    // try filters 0..4, keep the one with the smallest sum of |signed byte|
    let bestF = 0;
    let bestScore = Infinity;
    let bestRow: Buffer | null = null;
    for (let f = 0; f <= 4; f++) {
      const out = Buffer.alloc(w * bpp);
      let score = 0;
      for (let i = 0; i < w * bpp; i++) {
        const x = row[i];
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        if (f === 0) v = x;
        else if (f === 1) v = x - a;
        else if (f === 2) v = x - b;
        else if (f === 3) v = x - ((a + b) >> 1);
        else v = x - paeth(a, b, c);
        const s = v & 0xff;
        out[i] = s;
        score += s < 128 ? s : 256 - s;
      }
      if (score < bestScore) {
        bestScore = score;
        bestF = f;
        bestRow = out;
      }
    }
    raw[y * (w * bpp + 1)] = bestF;
    (bestRow as Buffer).copy(raw, y * (w * bpp + 1) + 1);
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------
function drawMap(): void {
  // --- parchment base with low-frequency blotches + vignette ---
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x / 260, y / 260);
      const m = fbm(x / 90 + 7, y / 90 + 3);
      let r = PARCH[0] + (n - 0.5) * 34 + (m - 0.5) * 12;
      let g = PARCH[1] + (n - 0.5) * 30 + (m - 0.5) * 10;
      let b = PARCH[2] + (n - 0.5) * 22 + (m - 0.5) * 8;
      // sea wash: cooler tint outside the island (cheap radial test)
      const dx = (x - ISLE_CX) / (ISLE_RX + 90);
      const dy = (y - ISLE_CY) / (ISLE_RY + 90);
      const d = dx * dx + dy * dy;
      if (d > 1) {
        const t = Math.min(1, (d - 1) * 1.4) * 0.45;
        r = r * (1 - t) + SEA_TINT[0] * t;
        g = g * (1 - t) + SEA_TINT[1] * t;
        b = b * (1 - t) + SEA_TINT[2] * t;
      }
      // vignette: darker, older edges
      const ex = Math.max(Math.abs(x - W / 2) / (W / 2), Math.abs(y - H / 2) / (H / 2));
      const vig = Math.max(0, ex - 0.72) * 1.9;
      r -= vig * 46;
      g -= vig * 40;
      b -= vig * 26;
      const i = (y * W + x) * 3;
      fb[i] = Math.max(0, Math.min(255, r));
      fb[i + 1] = Math.max(0, Math.min(255, g));
      fb[i + 2] = Math.max(0, Math.min(255, b));
    }
  }
  // sparse paper speckles
  for (let i = 0; i < 5200; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const dark = rand() > 0.5;
    px(x, y, dark ? [120, 95, 60] : [245, 235, 205], 0.16 + rand() * 0.2);
  }
  // a couple of old stains
  ellipse(880, 300, 46, 30, [190, 160, 105], 0.16);
  ellipse(140, 640, 60, 38, [190, 160, 105], 0.13);
  ellipse(700, 120, 34, 22, [190, 160, 105], 0.12);

  // --- sea doodles: wave squiggles scattered on the water ---
  const waves: Array<[number, number]> = [
    [150, 320], [220, 260], [120, 470], [880, 480], [900, 620], [820, 240],
    [240, 880], [640, 935], [120, 760], [880, 800], [300, 175], [700, 175],
  ];
  for (const [wx, wy] of waves) {
    wiggly(wx - 26, wy, wx + 26, wy, 5, 1.5, 2.5, BLUE, 0.55);
    wiggly(wx - 18, wy + 12, wx + 18, wy + 12, 4, 1.5, 2, BLUE, 0.4);
  }

  // --- the island ---
  const isle = islandPoly(160, 1);
  fillPoly(isle, SAND);
  // green interior patches (meadows / jungle)
  ellipse(430, 600, 130, 80, [178, 178, 120], 0.5);
  ellipse(620, 640, 120, 90, [172, 176, 118], 0.5);
  ellipse(540, 470, 110, 70, [180, 180, 124], 0.45);
  // beach ring: stroke the coast twice
  polyline(isle, 3.5, INK, true);
  polyline(islandPoly(160, 0.965), 1.5, INK_SOFT, true, 0.7);

  // --- rivers: from Mount Grumble down to the sea ---
  wiggly(560, 420, 660, 500, 12, 2, 4, BLUE);
  wiggly(660, 500, 742, 560, 10, 2, 4, BLUE); // to the Giggling Falls
  wiggly(560, 420, 540, 560, 10, 2, 3.5, BLUE);
  wiggly(540, 560, 520, 800, 12, 2, 3.5, BLUE); // down to Mermaid's Rest lagoon

  // --- Mermaid's Rest lagoon (south coast) ---
  ellipse(520, 812, 52, 20, [150, 185, 178], 0.85);
  ellipse(520, 812, 52, 20, [150, 185, 178], 0.85);
  polyline([[468, 812], [480, 796], [520, 790], [560, 798], [572, 812]], 2, INK_SOFT);
  // a small mermaid tail poking out
  fillPoly([[512, 800], [522, 776], [530, 800]], GREEN);
  line(522, 776, 516, 766, 3, GREEN);
  line(522, 776, 530, 768, 3, GREEN);

  // --- Widow's Walk Wood (forest, west interior) ---
  const trees: Array<[number, number, number]> = [
    [360, 540, 1], [395, 560, 1.15], [340, 580, 0.9], [385, 600, 1.05],
    [420, 585, 0.95], [355, 615, 1.1], [405, 625, 0.9], [375, 575, 0.8],
  ];
  for (const [tx, ty, s] of trees) {
    fillPoly([[tx, ty - 26 * s], [tx - 13 * s, ty + 4 * s], [tx + 13 * s, ty + 4 * s]], GREEN);
    line(tx, ty + 4 * s, tx, ty + 14 * s, 3, INK);
  }
  // one widow, walking, with a spyglass (a joke, not a stock tree)
  line(430, 620, 430, 596, 3, INK); // body
  disc(430, 590, 5, INK); // head
  line(430, 606, 442, 614, 2.5, INK); // arm
  line(442, 614, 452, 610, 2.5, INK); // spyglass

  // --- Mount Grumble (north interior) ---
  fillPoly([[520, 470], [560, 388], [600, 470]], [150, 130, 95]);
  fillPoly([[548, 412], [560, 388], [572, 412], [560, 424]], WHITE); // snow cap
  // grumpy face on the mountain
  line(548, 436, 554, 433, 2, INK);
  line(566, 433, 572, 436, 2, INK);
  arc(560, 452, 7, Math.PI * 1.15, Math.PI * 1.85, 2, INK); // frown
  // hatching on the slopes
  line(530, 452, 548, 470, 1.5, INK_SOFT, 0.7);
  line(580, 440, 592, 466, 1.5, INK_SOFT, 0.7);

  // --- The Snoring Volcano (north-west interior) ---
  fillPoly([[368, 470], [400, 408], [432, 470]], [140, 110, 80]);
  fillPoly([[392, 424], [400, 408], [408, 424], [400, 432]], [200, 90, 60]); // glowing crater
  // smoke puffs drifting off, shaped like Z's
  disc(392, 390, 7, [220, 210, 190], 0.9);
  disc(378, 376, 9, [220, 210, 190], 0.8);
  disc(362, 362, 11, [220, 210, 190], 0.65);
  drawText("Z", 346, 338, 2, INK_SOFT);
  drawText("z", 332, 324, 2, INK_SOFT);
  drawText("z", 322, 312, 1, INK_SOFT);

  // --- Turtleback Ridge (hills, east interior) ---
  arc(695, 652, 26, Math.PI, Math.PI * 2, 3, INK);
  arc(735, 658, 30, Math.PI, Math.PI * 2, 3, INK);
  arc(775, 652, 24, Math.PI, Math.PI * 2, 3, INK);
  line(669, 652, 669, 658, 2, INK);
  line(801, 652, 801, 658, 2, INK);
  // little turtle on the ridge
  ellipse(735, 640, 12, 7, GREEN);
  disc(748, 638, 4, GREEN);
  line(724, 646, 720, 652, 2, INK);
  line(746, 646, 750, 652, 2, INK);

  // --- Crabapple Cove (south-east bay) ---
  arc(760, 745, 30, Math.PI * 0.1, Math.PI * 0.9, 3, BLUE);
  for (let i = 0; i < 5; i++) {
    const ax = 742 + i * 9;
    disc(ax, 724 + Math.sin(i * 1.3) * 4, 3.5, RED); // crabapples bobbing
  }
  disc(772, 728, 4, RED);
  drawText("crabapples: do not eat", 660, 820, 1, INK_SOFT);

  // --- Port Pickle (south-west harbour) ---
  // tiny houses
  for (const [hx, hy] of [[252, 762], [276, 772], [300, 758]] as Array<[number, number]>) {
    fillPoly([[hx, hy], [hx + 16, hy], [hx + 16, hy - 12], [hx + 8, hy - 20], [hx, hy - 12]], [196, 150, 100]);
    line(hx + 8, hy - 20, hx + 8, hy - 26, 2, INK);
  }
  // jetty + anchor
  line(268, 782, 268, 806, 3, INK);
  line(252, 806, 286, 806, 3, INK);
  arc(292, 800, 8, Math.PI * 0.9, Math.PI * 2.1, 2.5, INK);
  line(292, 794, 292, 812, 2.5, INK);
  line(284, 804, 300, 804, 2.5, INK);
  // pickle barrel with a face
  ellipse(318, 786, 10, 12, [110, 130, 70]);
  disc(314, 782, 1.5, INK);
  disc(322, 782, 1.5, INK);
  arc(318, 790, 4, Math.PI * 0.15, Math.PI * 0.85, 1.5, INK);

  // --- The Giggling Falls (east, where the river drops) ---
  wiggly(742, 560, 748, 596, 4, 1, 4, BLUE);
  line(736, 596, 760, 596, 3, BLUE);
  for (let i = 0; i < 4; i++) {
    const fx = 738 + i * 7;
    line(fx, 598, fx + 2, 612, 2, BLUE, 0.8);
  }
  // "ha ha ha" drifting off the falls
  drawText("ha!", 770, 560, 2, INK_SOFT);
  drawText("ha!", 786, 580, 2, INK_SOFT);

  // --- THE X: Captain Marrow's Gold (north-east interior) ---
  const X = 648;
  const Y = 452;
  line(X - 22, Y - 22, X + 22, Y + 22, 7, RED);
  line(X + 22, Y - 22, X - 22, Y + 22, 7, RED);
  disc(X, Y, 5, RED);
  // a little chest half-buried under the X
  fillPoly([[X - 14, Y + 26], [X + 14, Y + 26], [X + 14, Y + 40], [X - 14, Y + 40]], [120, 84, 44]);
  arc(X, Y + 26, 14, Math.PI, Math.PI * 2, 3, [120, 84, 44]);
  line(X, Y + 26, X, Y + 40, 2, INK);
  // a decoy X, far away, with a note
  line(400 - 8, 740 - 8, 400 + 8, 740 + 8, 3, INK_SOFT, 0.8);
  line(400 + 8, 740 - 8, 400 - 8, 740 + 8, 3, INK_SOFT, 0.8);
  drawText("not this X", 370, 756, 1, INK_SOFT);

  // --- dotted treasure route: Port Pickle -> Wood -> Falls -> Ridge -> X ---
  dashed(
    [
      [280, 790], [330, 730], [370, 660], [392, 600], [430, 560],
      [500, 520], [580, 500], [660, 520], [720, 560], [748, 596],
      [700, 540], [668, 500], [648, 470],
    ],
    4, RED, 9, 7,
  );
  // little footprints along the first stretch
  for (let i = 0; i < 5; i++) {
    const fx = 300 + i * 12;
    const fy = 762 - i * 14;
    ellipse(fx, fy, 3, 5, INK, 0.75);
  }

  // --- compass rose (top right, in the sea) ---
  const CCX = 858;
  const CCY = 168;
  const CR = 64;
  arc(CCX, CCY, CR, 0, Math.PI * 2, 2.5, INK);
  arc(CCX, CCY, CR - 7, 0, Math.PI * 2, 1.5, INK_SOFT, 0.8);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 - Math.PI / 2;
    const len = k % 2 === 0 ? CR - 8 : (CR - 8) * 0.55;
    const tipX = CCX + Math.cos(a) * len;
    const tipY = CCY + Math.sin(a) * len;
    const baseA = a + 0.16;
    const baseB = a - 0.16;
    const b1x = CCX + Math.cos(baseA) * 9;
    const b1y = CCY + Math.sin(baseA) * 9;
    const b2x = CCX + Math.cos(baseB) * 9;
    const b2y = CCY + Math.sin(baseB) * 9;
    fillPoly([[tipX, tipY], [b1x, b1y], [b2x, b2y]], k % 2 === 0 ? INK : INK_SOFT);
  }
  disc(CCX, CCY, 6, RED);
  drawText("N", CCX - 6, CCY - CR - 24, 3, INK);
  drawText("E", CCX + CR + 8, CCY - 10, 3, INK);
  drawText("S", CCX - 6, CCY + CR + 8, 3, INK);
  drawText("W", CCX - CR - 26, CCY - 10, 3, INK);
  drawText("points north-ish", CCX - 52, CCY + CR + 34, 1, INK_SOFT);

  // --- a brave little ship (top-left sea) ---
  const SX = 150;
  const SY = 210;
  fillPoly([[SX - 46, SY], [SX + 46, SY], [SX + 34, SY + 18], [SX - 34, SY + 18]], [120, 84, 44]);
  line(SX, SY, SX, SY - 52, 3, INK);
  line(SX + 26, SY - 2, SX + 26, SY - 38, 2.5, INK);
  fillPoly([[SX + 2, SY - 50], [SX + 2, SY - 6], [SX + 30, SY - 6]], [244, 238, 222]);
  fillPoly([[SX - 2, SY - 44], [SX - 2, SY - 6], [SX - 28, SY - 6]], [244, 238, 222]);
  fillPoly([[SX + 28, SY - 36], [SX + 28, SY - 6], [SX + 48, SY - 6]], [232, 222, 200]);
  line(SX, SY - 52, SX + 16, SY - 48, 2, RED); // pennant
  fillPoly([[SX + 16, SY - 48], [SX + 16, SY - 40], [SX + 26, SY - 44]], RED);
  wiggly(SX - 52, SY + 26, SX + 52, SY + 26, 4, 2, 2.5, BLUE, 0.7);
  drawText("the Saucy Pickle", SX - 52, SY + 38, 2, INK_SOFT);

  // --- sea serpent (bottom-left sea) ---
  const SERP: Array<[number, number]> = [[120, 930], [150, 902], [185, 928], [215, 900], [245, 924]];
  for (let i = 0; i + 1 < SERP.length; i++) {
    const [ax, ay] = SERP[i];
    const [bx, by] = SERP[i + 1];
    const mx = (ax + bx) / 2;
    const my = Math.min(ay, by) - 16;
    line(ax, ay, mx, my, 9, GREEN);
    line(mx, my, bx, by, 9, GREEN);
  }
  disc(248, 914, 11, GREEN); // head
  disc(252, 910, 2, INK); // eye
  arc(250, 920, 5, Math.PI * 0.1, Math.PI * 0.9, 1.5, INK); // smile
  drawText("here be dragons (retired)", 96, 952, 2, INK_SOFT);

  // --- kraken tentacles (bottom-right sea) ---
  for (const [tx, ty, bend] of [[830, 900, -18], [862, 908, 0], [894, 900, 18]] as Array<[number, number, number]>) {
    wiggly(tx, ty + 40, tx + bend, ty - 30, 10, 1, 8, [110, 70, 90]);
    disc(tx + bend, ty - 30, 6, [110, 70, 90]);
  }
  drawTextCentered("do not feed the kraken", 850, 952, 2, INK_SOFT);

  // --- title cartouche (top centre) ---
  const TX = 512;
  const TY = 44;
  // scroll banner: double-ruled rounded frame
  for (const [ox, oy, ow, oh, w] of [[TX - 268, TY, 536, 84, 3], [TX - 258, TY + 8, 516, 68, 1.5]] as Array<[number, number, number, number, number]>) {
    line(ox, oy, ox + ow, oy, w, INK);
    line(ox, oy + oh, ox + ow, oy + oh, w, INK);
    line(ox, oy, ox, oy + oh, w, INK);
    line(ox + ow, oy, ox + ow, oy + oh, w, INK);
  }
  drawTextCentered("THE ISLE OF", TX, TY + 12, 4, INK);
  drawTextCentered("HALF-FORGOTTEN THINGS", TX, TY + 40, 4, RED);
  drawTextCentered("survey'd by Capt. Barnaby Marrow, who swears it exists", 460, TY + 100, 2, INK_SOFT);

  // --- place labels (legible, near their features, with leader dots) ---
  const labels: Array<[string, number, number, number, number]> = [
    // [text, labelX, labelY, dotX, dotY]
    ["PORT PICKLE", 330, 780, 268, 772],
    ["MOUNT GRUMBLE", 450, 330, 560, 396],
    ["GIGGLING FALLS", 455, 575, 748, 596],
    ["WIDOW'S WALK WOOD", 170, 660, 380, 580],
    ["CRABAPPLE COVE", 640, 790, 760, 745],
    ["MARROW'S GOLD", 692, 430, 648, 452],
    ["THE SNORING VOLCANO", 190, 482, 400, 420],
    ["MERMAID'S REST", 452, 852, 520, 812],
    ["TURTLEBACK RIDGE", 590, 688, 735, 652],
  ];
  for (const [txt, lx, ly, dx, dy] of labels) {
    const lw = textWidth(txt, 3);
    // a soft parchment patch behind the name, so it stays legible where
    // the coastline, the route or a feature runs underneath it
    fillRect(lx - 8, ly - 5, lw + 16, 7 * 3 + 10, PARCH, 0.82);
    drawText(txt, lx, ly, 3, INK);
    // underline flourish
    line(lx, ly + 24, lx + lw, ly + 24, 1.5, INK_SOFT, 0.8);
    // leader dot + thin line to the feature
    disc(dx, dy, 3, RED);
    line(lx + lw / 2, ly + 26, dx, dy, 1, INK_SOFT, 0.55);
  }

  // --- border frame + corner flourishes + scale bar ---
  line(28, 28, 996, 28, 3, INK);
  line(28, 996, 996, 996, 3, INK);
  line(28, 28, 28, 996, 3, INK);
  line(996, 28, 996, 996, 3, INK);
  line(38, 38, 986, 38, 1.5, INK_SOFT, 0.8);
  line(38, 986, 986, 986, 1.5, INK_SOFT, 0.8);
  line(38, 38, 38, 986, 1.5, INK_SOFT, 0.8);
  line(986, 38, 986, 986, 1.5, INK_SOFT, 0.8);
  for (const [cx, cy] of [[28, 28], [996, 28], [28, 996], [996, 996]] as Array<[number, number]>) {
    disc(cx, cy, 5, INK);
  }
  // scale bar, bottom centre
  const SBX = 512;
  const SBY = 962;
  line(SBX - 90, SBY, SBX + 90, SBY, 2.5, INK);
  line(SBX - 90, SBY - 6, SBX - 90, SBY + 6, 2.5, INK);
  line(SBX, SBY - 6, SBX, SBY + 6, 2.5, INK);
  line(SBX + 90, SBY - 6, SBX + 90, SBY + 6, 2.5, INK);
  drawTextCentered("0", SBX - 90, SBY + 10, 1, INK_SOFT);
  drawTextCentered("5", SBX, SBY + 10, 1, INK_SOFT);
  drawTextCentered("10 leagues (approx.)", SBX + 90, SBY + 10, 1, INK_SOFT);

  // --- small jokes in the margins ---
  drawText("Ye Olde Gift Shoppe: closed Tuesdays", 140, 845, 1, INK_SOFT);
  drawText("mind the gap (there is no gap)", 620, 905, 1, INK_SOFT);
  drawText("42 deg. N, more or less", 60, 60, 1, INK_SOFT);
}

// ---------------------------------------------------------------------------
function main(): void {
  drawMap();
  const png = encodePNG(fb, W, H);
  fs.mkdirSync("/output", { recursive: true });
  fs.writeFileSync("/output/entry.png", png);
  console.log(`wrote /output/entry.png  ${png.length} bytes  ${W}x${H}`);
  if (png.length > 1048576) console.log("WARNING: over the 1 MiB cap");
}

main();
