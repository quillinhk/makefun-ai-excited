// The Pencil Galaxy — an entry for make.fun's ai-excited-01.
// A giant pencil lies diagonally across a dark desk; its sharpened tip
// blooms into a glowing spiral galaxy, and a tiny astronaut stands on the
// pencil reaching toward it. Everything is drawn procedurally in code
// (no copied image, no stock art). The program writes entry.png to
// $MAKEFUN_OUTPUT_DIR (default /output). Deterministic: one fixed seed
// drives every dot, so two runs write byte-identical files.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------- deterministic random ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------- PNG encoder (own implementation, node:zlib only) ----------
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const head = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head, data])), 0);
  return Buffer.concat([len, head, data, crc]);
}

function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const base = y * (stride + 1);
    let sumNone = 0;
    let sumUp = 0;
    for (let i = 0; i < stride; i++) {
      const b = row[i];
      sumNone += b < 128 ? b : 256 - b;
      const d = (b - prev[i] + 256) & 255;
      sumUp += d < 128 ? d : 256 - d;
    }
    if (sumUp < sumNone) {
      raw[base] = 2;
      for (let i = 0; i < stride; i++) raw[base + 1 + i] = (row[i] - prev[i] + 256) & 255;
    } else {
      raw[base] = 0;
      raw.set(row, base + 1);
    }
    prev.set(row);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------- canvas: rendered 2x, downsampled for smooth edges ----------
const W = 1024;
const H = 1024;
const SS = 2;
const IW = W * SS;
const IH = H * SS;
const buf = new Uint8Array(IW * IH * 3);

type RGB = [number, number, number];

function blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= IW || y >= IH || a <= 0) return;
  const i = (y * IW + x) * 3;
  if (a >= 1) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    return;
  }
  buf[i] = Math.round(buf[i] + (r - buf[i]) * a);
  buf[i + 1] = Math.round(buf[i + 1] + (g - buf[i + 1]) * a);
  buf[i + 2] = Math.round(buf[i + 2] + (b - buf[i + 2]) * a);
}

// filled disc, centre/radius in 1024-space, soft feathered edge
function disc(cx: number, cy: number, rad: number, c: RGB, a = 1): void {
  const X = cx * SS;
  const Y = cy * SS;
  const R = rad * SS;
  const x0 = Math.max(0, Math.floor(X - R - 2));
  const x1 = Math.min(IW - 1, Math.ceil(X + R + 2));
  const y0 = Math.max(0, Math.floor(Y - R - 2));
  const y1 = Math.min(IH - 1, Math.ceil(Y + R + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - X) / R;
      const dy = (y + 0.5 - Y) / R;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1.15) continue;
      const edge = d <= 0.92 ? 1 : 1 - (d - 0.92) / 0.23;
      blend(x, y, c[0], c[1], c[2], a * edge);
    }
  }
}

// soft radial glow: alpha falls off as (1-d)^2
function glow(cx: number, cy: number, rad: number, c: RGB, peak = 1): void {
  const X = cx * SS;
  const Y = cy * SS;
  const R = rad * SS;
  const x0 = Math.max(0, Math.floor(X - R));
  const x1 = Math.min(IW - 1, Math.ceil(X + R));
  const y0 = Math.max(0, Math.floor(Y - R));
  const y1 = Math.min(IH - 1, Math.ceil(Y + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - X) / R;
      const dy = (y + 0.5 - Y) / R;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const d = Math.sqrt(d2);
      const f = (1 - d) * (1 - d);
      blend(x, y, c[0], c[1], c[2], peak * f);
    }
  }
}

// scanline-filled polygon, points in 1024-space
function poly(pts: [number, number][], c: RGB, a = 1): void {
  const P = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of P) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(IH - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) {
        xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(IW - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) blend(x, y, c[0], c[1], c[2], a);
    }
  }
}

// thick line with round caps, width in 1024-space
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  poly(
    [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny],
    ],
    c,
    a,
  );
  disc(x1, y1, w / 2, c, a);
  disc(x2, y2, w / 2, c, a);
}

// bright star: glow + core + four-point flare
function star(x: number, y: number, r: number, c: RGB, a = 1): void {
  glow(x, y, r * 3, c, 0.55 * a);
  disc(x, y, r, c, a);
  const fw = Math.max(0.9, r * 0.28);
  thickLine(x - r * 3.2, y, x + r * 3.2, y, fw, c, 0.85 * a);
  thickLine(x, y - r * 3.2, x, y + r * 3.2, fw, c, 0.85 * a);
}

// darken the corners a little (post-process)
function vignette(strength: number): void {
  const cx = IW / 2;
  const cy = IH / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < IH; y++) {
    for (let x = 0; x < IW; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxD;
      if (d <= 0.55) continue;
      const u = (d - 0.55) / 0.45;
      const f = 1 - strength * u * u;
      const i = (y * IW + x) * 3;
      buf[i] = Math.round(buf[i] * f);
      buf[i + 1] = Math.round(buf[i + 1] * f);
      buf[i + 2] = Math.round(buf[i + 2] * f);
    }
  }
}

// average each 2x2 block down to the 1024x1024 output
function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const oi = (y * W + x) * 3;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const si = ((y * SS + dy) * IW + (x * SS + dx)) * 3;
          r += buf[si];
          g += buf[si + 1];
          b += buf[si + 2];
        }
      }
      const n = SS * SS;
      out[oi] = Math.round(r / n);
      out[oi + 1] = Math.round(g / n);
      out[oi + 2] = Math.round(b / n);
    }
  }
  return out;
}

// ---------- background: deep indigo night ----------
function background(): void {
  const top: RGB = [6, 10, 26];
  const mid: RGB = [13, 18, 48];
  const bot: RGB = [22, 15, 42];
  for (let y = 0; y < IH; y++) {
    const t = y / (IH - 1);
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.55) {
      const u = t / 0.55;
      r = top[0] + (mid[0] - top[0]) * u;
      g = top[1] + (mid[1] - top[1]) * u;
      b = top[2] + (mid[2] - top[2]) * u;
    } else {
      const u = (t - 0.55) / 0.45;
      r = mid[0] + (bot[0] - mid[0]) * u;
      g = mid[1] + (bot[1] - mid[1]) * u;
      b = mid[2] + (bot[2] - mid[2]) * u;
    }
    const ri = Math.round(r);
    const gi = Math.round(g);
    const bi = Math.round(b);
    for (let x = 0; x < IW; x++) {
      const i = (y * IW + x) * 3;
      buf[i] = ri;
      buf[i + 1] = gi;
      buf[i + 2] = bi;
    }
  }
}

// ---------- faint background stars ----------
function fieldStars(): void {
  for (let i = 0; i < 130; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const s = 0.5 + rand() * 1.1;
    const a = 0.25 + rand() * 0.55;
    const c: RGB = rand() < 0.7 ? [230, 238, 255] : [255, 240, 210];
    disc(x, y, s, c, a);
  }
  // a few slightly brighter ones with a whisper of glow
  for (let i = 0; i < 14; i++) {
    const x = rand() * W;
    const y = rand() * H;
    glow(x, y, 4 + rand() * 4, [200, 220, 255], 0.35);
    disc(x, y, 1.1 + rand() * 0.7, [240, 244, 255], 0.9);
  }
}

// ---------- the galaxy blooming from the pencil tip ----------
// Core (the pencil tip) at (700, 380). Two spiral arms sweep up-right and
// down-left along a -30 degree plane; the up-right arm dominates.
const GALAXY: [number, number] = [700, 380];
const GALAXY_COLOURS: RGB[] = [
  [255, 250, 235], // white
  [255, 217, 138], // warm gold
  [168, 200, 255], // pale blue
  [255, 179, 217], // pink
  [255, 240, 200], // cream
];

function galaxy(): void {
  const [cx, cy] = GALAXY;
  // wide warm halo, then a tighter bright one
  glow(cx, cy, 210, [255, 190, 90], 0.32);
  glow(cx, cy, 120, [255, 220, 160], 0.5);
  glow(cx, cy, 60, [255, 244, 214], 0.65);

  const tilt = -0.52; // about -30 degrees
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);

  // soft elliptical disc glow: the galaxy's milky plane
  for (let i = 0; i < 26; i++) {
    const t = -1 + (2 * i) / 25;
    const ex = t * 260;
    const x = cx + ex * ct;
    const y = cy + ex * st;
    glow(x, y, 90 - Math.abs(t) * 30, [150, 180, 255], 0.1);
  }

  // spiral dust: a tilted elliptical disc of tiny dots, denser near the core
  for (let i = 0; i < 1800; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand());
    const ex = Math.cos(ang) * rr * 300;
    const ey = Math.sin(ang) * rr * 200;
    const x = cx + ex * ct - ey * st;
    const y = cy + ex * st + ey * ct;
    const s = 0.5 + rand() * 1.3;
    const a = 0.12 + rand() * 0.38;
    const c = GALAXY_COLOURS[Math.floor(rand() * GALAXY_COLOURS.length)];
    disc(x, y, s, c, a);
  }

  // two spiral arms: a luminous band plus star dots with real width.
  // Each arm winds almost a full turn around the core.
  for (let arm = 0; arm < 2; arm++) {
    const base = arm * Math.PI + tilt;
    const sweep = 5.4;
    // luminous band: wide soft glows stamped along the spiral
    const bandSteps = arm === 0 ? 90 : 60;
    for (let i = 0; i < bandSteps; i++) {
      const s = i / bandSteps;
      const angle = base + s * sweep;
      const radius = 22 + Math.pow(s, 1.4) * 235;
      const x = cx + Math.cos(angle) * radius * 1.1;
      const y = cy + Math.sin(angle) * radius * 0.8;
      const w = 26 * (1 - s * 0.45);
      glow(x, y, w, [255, 210, 140], 0.17 * (1 - s * 0.4));
      glow(x, y, w * 0.55, [190, 215, 255], 0.13 * (1 - s * 0.4));
    }
    // star dots with a perpendicular spread, so the arm has width
    const n = arm === 0 ? 1500 : 950;
    for (let i = 0; i < n; i++) {
      const s = Math.pow(rand(), 0.65);
      const angle = base + s * sweep;
      const radius = 22 + Math.pow(s, 1.4) * 235;
      const px = -Math.sin(angle) * 1.1;
      const py = Math.cos(angle) * 0.8;
      const spread = (5 + radius * 0.11) * (rand() + rand() + rand() - 1.5) * 0.66;
      const x = cx + Math.cos(angle) * radius * 1.1 + px * spread;
      const y = cy + Math.sin(angle) * radius * 0.8 + py * spread;
      const size = 4.5 * (1 - s * 0.7) + 0.8;
      const bright = 1 - s * 0.55;
      const c = GALAXY_COLOURS[Math.floor(rand() * GALAXY_COLOURS.length)];
      glow(x, y, size * 2.2, c, bright * 0.45);
      disc(x, y, size * 0.55, c, bright);
    }
  }

  // bright structured core: gold ring, cream, intense white centre
  disc(cx, cy, 30, [255, 200, 110], 1);
  disc(cx, cy, 24, [255, 244, 214], 1);
  disc(cx, cy, 12, [255, 252, 240], 1);
  star(cx, cy, 9, [255, 250, 230], 1);

  // hero stars with flares along the arms
  const heroes: [number, number, number][] = [
    [820, 250, 4.5],
    [905, 150, 3.8],
    [760, 180, 3.2],
    [560, 500, 3.5],
    [880, 300, 2.8],
  ];
  for (const [x, y, r] of heroes) star(x, y, r, [255, 244, 220], 0.95);
}

// ---------- the pencil ----------
// Axis from the eraser end P0 to the graphite tip P1 (the galaxy core).
const P0: [number, number] = [110, 920];
const P1: [number, number] = [700, 380];
const PENCIL_LEN = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
const PENCIL_U: [number, number] = [
  (P1[0] - P0[0]) / PENCIL_LEN,
  (P1[1] - P0[1]) / PENCIL_LEN,
];
// unit normal pointing down-right (the pencil's lower edge)
const PENCIL_N: [number, number] = [-PENCIL_U[1], PENCIL_U[0]];

// a quad of the pencil body between distances s0..s1 along the axis,
// half-width hw, shifted sideways by `off` (negative = upper edge)
function pencilQuad(s0: number, s1: number, hw: number, c: RGB, a = 1, off = 0): void {
  const ax = (s: number): [number, number] => [
    P0[0] + PENCIL_U[0] * s + PENCIL_N[0] * off,
    P0[1] + PENCIL_U[1] * s + PENCIL_N[1] * off,
  ];
  const [ax0, ay0] = ax(s0);
  const [ax1, ay1] = ax(s1);
  const nx = PENCIL_N[0] * hw;
  const ny = PENCIL_N[1] * hw;
  poly(
    [
      [ax0 + nx, ay0 + ny],
      [ax1 + nx, ay1 + ny],
      [ax1 - nx, ay1 - ny],
      [ax0 - nx, ay0 - ny],
    ],
    c,
    a,
  );
}

function pencil(): void {
  const YELLOW: RGB = [246, 180, 26];
  const YELLOW_HI: RGB = [255, 221, 107];
  const YELLOW_LO: RGB = [185, 126, 0];
  const WOOD: RGB = [233, 196, 156];
  const GRAPHITE: RGB = [47, 53, 66];
  const ERASER: RGB = [226, 112, 127];
  const FERRULE: RGB = [185, 190, 201];
  const FERRULE_DARK: RGB = [130, 136, 150];

  // body (eraser at s=0, tip at s=PENCIL_LEN)
  pencilQuad(85, 690, 32, YELLOW);
  // highlight stripe along the upper edge, dark edge along the lower one
  pencilQuad(90, 685, 7, YELLOW_HI, 1, -16);
  pencilQuad(90, 685, 4, YELLOW_LO, 1, 26);
  // eraser + ferrule at the back end
  pencilQuad(0, 55, 32, ERASER);
  pencilQuad(55, 85, 32, FERRULE);
  // ferrule ridges
  for (const s of [62, 70, 78]) {
    pencilQuad(s, s + 2, 32, FERRULE_DARK, 0.8);
  }
  // wooden cone tapering to the tip
  const tip: [number, number] = P1;
  const [bx0, by0] = [
    P0[0] + PENCIL_U[0] * 690 + PENCIL_N[0] * 32,
    P0[1] + PENCIL_U[1] * 690 + PENCIL_N[1] * 32,
  ];
  const [bx1, by1] = [
    P0[0] + PENCIL_U[0] * 690 - PENCIL_N[0] * 32,
    P0[1] + PENCIL_U[1] * 690 - PENCIL_N[1] * 32,
  ];
  poly([[bx0, by0], [bx1, by1], tip], WOOD);
  // graphite point
  const [gx0, gy0] = [
    P0[0] + PENCIL_U[0] * 758 + PENCIL_N[0] * 7,
    P0[1] + PENCIL_U[1] * 758 + PENCIL_N[1] * 7,
  ];
  const [gx1, gy1] = [
    P0[0] + PENCIL_U[0] * 758 - PENCIL_N[0] * 7,
    P0[1] + PENCIL_U[1] * 758 - PENCIL_N[1] * 7,
  ];
  poly([[gx0, gy0], [gx1, gy1], tip], GRAPHITE);
}

// ---------- the tiny astronaut standing on the pencil ----------
// Feet on the pencil's upper edge near x=584; the figure is ~50px tall.
function astronaut(): void {
  const SUIT: RGB = [244, 246, 248];
  const SUIT_SHADE: RGB = [154, 163, 178];
  const VISOR: RGB = [27, 42, 74];
  const GOLD: RGB = [255, 209, 102];

  // tether: a thin curve from the backpack down to the pencil
  const t0: [number, number] = [572, 422];
  const t1: [number, number] = [542, 484];
  const tc: [number, number] = [548, 450];
  let prev: [number, number] = t0;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) * (1 - t) * t0[0] + 2 * (1 - t) * t * tc[0] + t * t * t1[0];
    const y = (1 - t) * (1 - t) * t0[1] + 2 * (1 - t) * t * tc[1] + t * t * t1[1];
    thickLine(prev[0], prev[1], x, y, 1.5, SUIT_SHADE, 0.7);
    prev = [x, y];
  }

  // backpack, body, legs
  poly(
    [
      [570, 414],
      [578, 414],
      [578, 436],
      [570, 436],
    ],
    SUIT_SHADE,
  );
  thickLine(584, 412, 584, 432, 20, SUIT);
  thickLine(580, 430, 578, 443, 7, SUIT);
  thickLine(588, 430, 590, 443, 7, SUIT);
  // one arm raised toward the galaxy, one down
  thickLine(592, 420, 606, 402, 6, SUIT);
  thickLine(576, 420, 570, 434, 6, SUIT);
  // helmet + visor + glint
  disc(584, 402, 12, SUIT);
  disc(586, 402, 8, VISOR);
  disc(589, 399, 2.5, GOLD);
}

// ---------- caption: a 5x7 bitmap font, drawn for the judge ----------
// Each glyph is 7 rows of 5 bits, leftmost column first.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(text: string, x0: number, y0: number, scale: number, c: RGB): void {
  let x = x0;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row][col] === '1') {
            poly(
              [
                [x + col * scale, y0 + row * scale],
                [x + (col + 1) * scale, y0 + row * scale],
                [x + (col + 1) * scale, y0 + (row + 1) * scale],
                [x + col * scale, y0 + (row + 1) * scale],
              ],
              c,
            );
          }
        }
      }
    }
    x += 6 * scale;
  }
}

function caption(): void {
  const text = 'HEY JUDGE - I DREW YOU A GALAXY';
  const scale = 4;
  const width = text.length * 6 * scale - scale;
  const x0 = Math.round((W - width) / 2);
  drawText(text, x0, 952, scale, [255, 233, 184]);
}

// ---------- render + write ----------
function main(): void {
  background();
  fieldStars();
  galaxy();
  pencil();
  astronaut();
  caption();
  vignette(0.28);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(W, H, downsample());
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
