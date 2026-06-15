#!/usr/bin/env node
// Extracts the original Chip's Challenge (Windows / MS) in-game BITMAP FONT and
// the level-start / PAUSED chrome from the ripped UI sheet.
//
// Input (gitignored, like extract-assets.mjs reads .src_game originals):
//   .src_game/spriters/window_27082.png  - 801x482 ripped Windows UI sheet
//     containing a yellow + white bitmap font (A-N / O-Z / 0-9 / symbols rows),
//     the red & white "PAUSED" words, and the yellow/white "Password:" boxes.
//
// Outputs (committed under assets/fonts/):
//   assets/fonts/source.png   - the input sheet, copied verbatim for provenance
//   assets/fonts/font.png      - WHITE master glyph atlas, TRANSPARENT bg. One
//                                horizontal strip: glyphs 0..N, 1px gaps. RGB is
//                                pure white; alpha is the glyph mask so the
//                                renderer can tint it any color (yellow title,
//                                white password line, red PAUSED).
//   assets/fonts/font.json     - metrics: { lineHeight, baseline, space, gap,
//                                glyphs: { "A": {x,y,w,h}, ... } }
//   assets/fonts/password-yellow.png - authentic "Password:" word, yellow, transp.
//   assets/fonts/password-white.png  - authentic "Password:" word, white, transp.
//
// The font is PROPORTIONAL (per-glyph widths), uppercase-only + digits. Glyphs
// in the sheet are separated by exactly one empty column. We segment the YELLOW
// block (cleanest) and emit white pixels keyed on the yellow ink mask; the glyph
// shapes are identical to the white block.
//
// Requires: the pngjs npm package.

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.src_game', 'spriters', 'window_27082.png');
const OUT = join(ROOT, 'assets', 'fonts');

function ensure(dir) { mkdirSync(dir, { recursive: true }); }

if (!existsSync(SRC)) {
  console.error(`Missing font sheet at ${SRC}. Place window_27082.png there first.`);
  process.exit(1);
}
ensure(OUT);

const sheet = PNG.sync.read(readFileSync(SRC));
const { width: SW, data: SD } = sheet;
const px = (x, y) => { const i = (y * SW + x) * 4; return [SD[i], SD[i + 1], SD[i + 2]]; };
const isYellow = (x, y) => { const [r, g, b] = px(x, y); return r > 150 && g > 140 && b < 130; };
const isWhite = (x, y) => { const [r, g, b] = px(x, y); return r > 190 && g > 190 && b > 190; };
const isRed = (x, y) => { const [r, g, b] = px(x, y); return r > 130 && g < 100 && b < 100; };

// --- 0. Copy the source sheet for provenance (committed) ---
copyFileSync(SRC, join(OUT, 'source.png'));
console.log('  copied source.png');

// --- 1. Bitmap font: segment the yellow block into per-glyph boxes ---
// Yellow font block lives at x[175,345]. Four rows (top,bottom inclusive),
// derived from the sheet's blank scanlines:
const YELLOW_X0 = 175, YELLOW_X1 = 345;
const ROW_BANDS = [
  { y0: 353, y1: 367, chars: 'ABCDEFGHIJKLMN'.split('') }, // uppercase A-N
  { y0: 369, y1: 384, chars: 'OPQRSTUVWXYZ'.split('') },   // uppercase O-Z
  { y0: 386, y1: 400, chars: '1234567890'.split('') },     // digits (1..9,0)
];

/** Split a row band into glyphs: maximal runs of columns containing >=1 ink px
 *  (a single empty column separates glyphs). Returns [x0,x1] inclusive pairs. */
function segmentRow(test, x0, x1, y0, y1) {
  const out = [];
  let inGlyph = false, start = 0;
  for (let x = x0; x <= x1; x++) {
    let ink = false;
    for (let y = y0; y <= y1; y++) if (test(x, y)) { ink = true; break; }
    if (ink && !inGlyph) { inGlyph = true; start = x; }
    else if (!ink && inGlyph) { inGlyph = false; out.push([start, x - 1]); }
  }
  if (inGlyph) out.push([start, x1]);
  return out;
}

/** Tight vertical extent of an ink box so all glyphs share a common baseline. */
function vExtent(test, x0, x1, y0, y1) {
  let top = y1, bot = y0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (test(x, y)) { if (y < top) top = y; if (y > bot) bot = y; break; }
  return [top, bot];
}

// Collect every glyph. Each glyph's vertical extent is measured WITHIN its own
// row band, then expressed relative to that band's baseline (the band bottom),
// so glyphs from different sheet rows can share one packed cell. The font is
// uppercase + digits only -> no descenders -> all glyphs are baseline-aligned.
const glyphs = [];
let maxAscent = 0; // tallest glyph height across all rows
for (const band of ROW_BANDS) {
  const cols = segmentRow(isYellow, YELLOW_X0, YELLOW_X1, band.y0, band.y1);
  if (cols.length !== band.chars.length) {
    throw new Error(`row "${band.chars.join('')}" expected ${band.chars.length} glyphs, got ${cols.length}`);
  }
  // Common baseline for this row = the lowest ink row in the band (glyphs sit on it).
  let bandBaseline = band.y0;
  cols.forEach(([gx0, gx1]) => { const [, bot] = vExtent(isYellow, gx0, gx1, band.y0, band.y1); if (bot > bandBaseline) bandBaseline = bot; });
  cols.forEach(([gx0, gx1], i) => {
    const [top, bot] = vExtent(isYellow, gx0, gx1, band.y0, band.y1);
    const h = bandBaseline - top + 1;            // glyph height up from the baseline
    maxAscent = Math.max(maxAscent, h);
    glyphs.push({ ch: band.chars[i], x0: gx0, x1: gx1, top, bot, bandBaseline });
  });
}

// Punctuation used by CHIPS.DAT level titles: '.' (I.C. YOU / "Thanks to...")
// and '?' (STRIPES?). The full symbols row segments ambiguously (multi-part
// glyphs like " and =), so take just these two by explicit, shape-verified
// boxes from the symbols band below the digits (period = lone baseline dot at
// x[409,411]; question mark = the rightmost glyph at x[431,441]).
{
  const SY0 = 400, SY1 = 421;
  const symBoxes = [
    { ch: '.', x0: 409, x1: 411 },
    { ch: '?', x0: 431, x1: 441 },
  ];
  // Shared baseline = the lowest ink among these (both rest on the text baseline).
  let symBaseline = SY0;
  for (const s of symBoxes) { const [, bot] = vExtent(isYellow, s.x0, s.x1, SY0, SY1); if (bot > symBaseline) symBaseline = bot; }
  for (const s of symBoxes) {
    const [top, bot] = vExtent(isYellow, s.x0, s.x1, SY0, SY1);
    maxAscent = Math.max(maxAscent, symBaseline - top + 1);
    glyphs.push({ ch: s.ch, x0: s.x0, x1: s.x1, top, bot, bandBaseline: symBaseline });
  }
}

// One shared cell: height = tallest glyph; every glyph bottom-aligned to baseline.
const CELL_H = maxAscent;       // e.g. 16
const GAP = 1;                  // 1px transparent gap between packed glyphs
const SPACE_W = 6;              // synthesized space advance (≈ a narrow glyph)

let atlasW = 0;
for (const g of glyphs) atlasW += (g.x1 - g.x0 + 1) + GAP;
atlasW += SPACE_W + GAP;        // trailing space glyph
const atlas = new PNG({ width: atlasW, height: CELL_H });
atlas.data.fill(0);             // fully transparent

const metrics = {
  note: "Authentic Chip's Challenge in-game bitmap font (uppercase A-Z + digits 0-9). " +
        'White master with alpha = glyph mask; tint at draw time. Proportional widths, ' +
        'baseline-aligned. Advance = glyph w + gap. cellHeight is the full glyph box.',
  lineHeight: CELL_H + 2,
  cellHeight: CELL_H,
  baseline: CELL_H,             // glyphs are bottom-aligned; baseline = cell bottom
  space: SPACE_W,
  gap: GAP,                     // inter-letter advance padding (px) when drawing
  glyphs: {},
};

// Blit each glyph: WHITE RGB, alpha = ink mask, bottom-aligned in the cell.
let cursor = 0;
for (const g of glyphs) {
  const gw = g.x1 - g.x0 + 1;
  const yBottomOffset = CELL_H - (g.bandBaseline - g.top + 1); // top padding to baseline-align
  for (let y = g.top; y <= g.bot; y++) {
    for (let x = g.x0; x <= g.x1; x++) {
      if (isYellow(x, y)) {
        const ax = cursor + (x - g.x0);
        const ay = (y - g.top) + yBottomOffset;
        const ai = (ay * atlasW + ax) * 4;
        atlas.data[ai] = 255; atlas.data[ai + 1] = 255; atlas.data[ai + 2] = 255; atlas.data[ai + 3] = 255;
      }
    }
  }
  metrics.glyphs[g.ch] = { x: cursor, y: 0, w: gw, h: CELL_H };
  cursor += gw + GAP;
}
// Space glyph: empty box, recorded for layout.
metrics.glyphs[' '] = { x: cursor, y: 0, w: SPACE_W, h: CELL_H };

writeFileSync(join(OUT, 'font.png'), PNG.sync.write(atlas));
writeFileSync(join(OUT, 'font.json'), JSON.stringify(metrics, null, 2) + '\n');
console.log(`  wrote font.png (${atlasW}x${CELL_H}, ${glyphs.length} glyphs + space)`);
console.log(`  wrote font.json (cellHeight=${CELL_H}, lineHeight=${metrics.lineHeight})`);

// --- 2. "Password:" word sprites (authentic mixed-case + colon), transparent ---
// Yellow box interior text bbox: x[189,290] y[457,471]. White box mirrors it,
// shifted by the box pitch (right box left border at x=369 vs left at x=176 => +193).
function cropWord(test, x0, x1, y0, y1, rgb) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (test(x, y)) {
        const i = ((y - y0) * w + (x - x0)) * 4;
        out.data[i] = rgb[0]; out.data[i + 1] = rgb[1]; out.data[i + 2] = rgb[2]; out.data[i + 3] = 255;
      }
  return out;
}
// Find the yellow "Password:" text extent precisely (within the yellow box).
function textBBox(test, x0, x1, y0, y1) {
  let mnX = x1, mxX = x0, mnY = y1, mxY = y0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (test(x, y)) {
    if (x < mnX) mnX = x; if (x > mxX) mxX = x; if (y < mnY) mnY = y; if (y > mxY) mxY = y;
  }
  return [mnX, mxX, mnY, mxY];
}
{
  const [yx0, yx1, yy0, yy1] = textBBox(isYellow, 178, 360, 430, 480);
  const pwY = cropWord(isYellow, yx0, yx1, yy0, yy1, [255, 255, 255]); // white mask, tint later
  writeFileSync(join(OUT, 'password.png'), PNG.sync.write(pwY));
  console.log(`  wrote password.png ("Password:" word mask ${yx1 - yx0 + 1}x${yy1 - yy0 + 1}, white/transparent)`);
}

// --- 3. PAUSED word sprite (white master, transparent) from the red PAUSED ---
{
  // The word's horizontal extent = columns with substantial (>=3px) red ink; this
  // trims a faint 1-2px stray tail to the right of the word in the rip.
  const Y0 = 397, Y1 = 424, X0 = 0, X1 = 200;
  const colInk = (x) => { let n = 0; for (let y = Y0; y <= Y1; y++) if (isRed(x, y)) n++; return n; };
  let rx0 = X1, rx1 = X0;
  for (let x = X0; x <= X1; x++) if (colInk(x) >= 3) { if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; }
  let ry0 = Y1, ry1 = Y0;
  for (let y = Y0; y <= Y1; y++) for (let x = rx0; x <= rx1; x++) if (isRed(x, y)) { if (y < ry0) ry0 = y; if (y > ry1) ry1 = y; break; }
  const paused = cropWord(isRed, rx0, rx1, ry0, ry1, [255, 255, 255]); // white mask, tint red at draw time
  writeFileSync(join(OUT, 'paused.png'), PNG.sync.write(paused));
  console.log(`  wrote paused.png ("PAUSED" word mask ${rx1 - rx0 + 1}x${ry1 - ry0 + 1}, white/transparent)`);
}

console.log('Done.');
