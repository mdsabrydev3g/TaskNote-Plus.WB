/**
 * Generates the PNG icon set from a single vector definition.
 *
 * Run with:  node scripts/generate-icons.mjs
 *
 * We render raw RGBA pixels and hand-roll a minimal PNG encoder rather than
 * pulling in a canvas or sharp dependency — the artwork is simple geometry,
 * and this keeps the install light and the output deterministic.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const BRAND_START = [99, 102, 241];
const BRAND_END = [67, 56, 202];
const ACCENT = [165, 180, 252];
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Signed distance from point p to the line segment ab — used for the strokes. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundedRectCoverage(x, y, size, radius) {
  // Inside test for a rounded square, sampled with 1px softness at the edges.
  const inX = Math.min(x, size - x);
  const inY = Math.min(y, size - y);
  if (inX < 0 || inY < 0) return 0;
  if (inX >= radius || inY >= radius) return 1;
  const dx = radius - inX;
  const dy = radius - inY;
  const d = Math.hypot(dx, dy) - radius;
  return Math.max(0, Math.min(1, 0.5 - d));
}

function renderIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 512;

  // Maskable icons need their artwork inside the safe zone (80% of the canvas).
  const inset = maskable ? size * 0.1 : 0;
  const drawingScale = maskable ? scale * 0.8 : scale;
  const offset = inset;

  const strokeWidth = 34 * drawingScale;
  const lineWidth = 26 * drawingScale;

  const checkA = { x: offset + 148 * drawingScale, y: offset + 268 * drawingScale };
  const checkB = { x: offset + 206 * drawingScale, y: offset + 326 * drawingScale };
  const checkC = { x: offset + 322 * drawingScale, y: offset + 202 * drawingScale };

  const lineY = offset + 358 * drawingScale;
  const lineX1 = offset + 156 * drawingScale;
  const lineX2 = offset + 356 * drawingScale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;

      // Background gradient
      const t = (x / size + y / size) / 2;
      let r = lerp(BRAND_START[0], BRAND_END[0], t);
      let g = lerp(BRAND_START[1], BRAND_END[1], t);
      let b = lerp(BRAND_START[2], BRAND_END[2], t);
      let alpha = 255;

      if (maskable) {
        // Maskable icons must be fully opaque across the whole canvas.
        alpha = 255;
      } else {
        const coverage = roundedRectCoverage(x, y, size, 112 * scale);
        alpha = Math.round(coverage * 255);
      }

      // The checkmark
      const dCheck = Math.min(
        distanceToSegment(x, y, checkA.x, checkA.y, checkB.x, checkB.y),
        distanceToSegment(x, y, checkB.x, checkB.y, checkC.x, checkC.y),
      );
      const checkCoverage = Math.max(0, Math.min(1, strokeWidth / 2 + 0.5 - dCheck));
      if (checkCoverage > 0) {
        r = lerp(r, WHITE[0], checkCoverage);
        g = lerp(g, WHITE[1], checkCoverage);
        b = lerp(b, WHITE[2], checkCoverage);
      }

      // The underline
      const dLine = distanceToSegment(x, y, lineX1, lineY, lineX2, lineY);
      const lineCoverage = Math.max(0, Math.min(1, lineWidth / 2 + 0.5 - dLine));
      if (lineCoverage > 0) {
        r = lerp(r, ACCENT[0], lineCoverage);
        g = lerp(g, ACCENT[1], lineCoverage);
        b = lerp(b, ACCENT[2], lineCoverage);
      }

      pixels[index] = Math.round(r);
      pixels[index + 1] = Math.round(g);
      pixels[index + 2] = Math.round(b);
      pixels[index + 3] = alpha;
    }
  }

  return pixels;
}

// ── Minimal PNG encoder ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "favicon-32.png", size: 32, maskable: false },
];

for (const target of targets) {
  const pixels = renderIcon(target.size, { maskable: target.maskable });
  const png = encodePng(pixels, target.size);
  writeFileSync(join(outDir, target.file), png);
  console.log(`  ✓ ${target.file} (${target.size}×${target.size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

console.log(`\nWrote ${targets.length} icons to public/icons/`);
