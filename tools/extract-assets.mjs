#!/usr/bin/env node
// Extracts the original Chip's Challenge (Windows / MS) assets into ./assets.
//
// Inputs (place the original game files here, e.g. unzipped from the archive.org item):
//   .src_game/extracted/CHIPS.EXE   - NE executable holding the tileset bitmaps
//   .src_game/extracted/CHIPS.DAT   - 149-level data file
//   .src_game/extracted/*.WAV       - sound effects
//   .src_game/extracted/*.MID       - music
//
// Outputs:
//   assets/tiles.png        - 416x512 RGBA sprite atlas (13 cols x 16 rows of 32x32 tiles)
//   assets/levels/CHIPS.DAT - copied verbatim
//   assets/sfx/*.ogg        - transcoded sound effects
//   assets/music/*.mid      - copied verbatim (synthesized in-browser)
//
// Requires: wrestool (icoutils), ffmpeg, and the pngjs npm package.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.src_game', 'extracted');
const TMP = join(ROOT, '.src_game', 'tmp');
const OUT = join(ROOT, 'assets');

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}
function ensure(dir) { mkdirSync(dir, { recursive: true }); }

if (!existsSync(join(SRC, 'CHIPS.EXE'))) {
  console.error(`Missing originals in ${SRC}. Unzip the game there first.`);
  process.exit(1);
}
ensure(TMP); ensure(OUT); ensure(join(OUT, 'sfx')); ensure(join(OUT, 'levels')); ensure(join(OUT, 'music'));

// --- 1. Tileset: extract color (OBJ32_4) + transparency mask (OBJ32_1) from the EXE ---
console.log('Extracting tileset bitmaps from CHIPS.EXE ...');
const exe = join(SRC, 'CHIPS.EXE');
const colorBmp = join(TMP, 'obj_color.bmp');
const maskBmp = join(TMP, 'obj_mask.bmp');
sh('wrestool', ['-x', '--type=2', '--name=OBJ32_4', exe, '-o', colorBmp]);
sh('wrestool', ['-x', '--type=2', '--name=OBJ32_1', exe, '-o', maskBmp]);

const colorPng = join(TMP, 'obj_color.png');
const maskPng = join(TMP, 'obj_mask.png');
// Decode the RLE4 / 1bpp DIBs to straight RGB/gray PNGs via ffmpeg.
sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', colorBmp, '-pix_fmt', 'rgb24', colorPng]);
sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', maskBmp, '-pix_fmt', 'gray', maskPng]);

const color = PNG.sync.read(readFileSync(colorPng));
const mask = PNG.sync.read(readFileSync(maskPng));
if (color.width !== mask.width || color.height !== mask.height) {
  throw new Error(`tile/mask size mismatch: ${color.width}x${color.height} vs ${mask.width}x${mask.height}`);
}
const { width, height } = color;
const TILE = 32;
const COLS = width / TILE; // 13
// MS sprite-sheet layout (13 cols x 16 rows of 32x32):
//   cols 0-6  : opaque tiles, codes 0x00-0x6F (column-major: index = col*16 + row)
//   cols 7-9  : transparent overlay sprites for codes 0x40-0x6F (image)
//   cols 10-12: the matching masks for cols 7-9 (mask col = image col + 3)
// White mask pixel (lum 255) = sprite/opaque, black (0) = transparent.
const MASKED_FIRST = 7, MASKED_LAST = 9, MASK_OFFSET = 3;
const atlas = new PNG({ width, height });
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    atlas.data[i] = color.data[i];
    atlas.data[i + 1] = color.data[i + 1];
    atlas.data[i + 2] = color.data[i + 2];
    const col = Math.floor(x / TILE);
    if (col >= MASKED_FIRST && col <= MASKED_LAST) {
      const mx = x + MASK_OFFSET * TILE; // matching mask pixel, 3 columns right
      atlas.data[i + 3] = mask.data[(y * width + mx) * 4]; // 255 opaque / 0 transparent
    } else {
      atlas.data[i + 3] = 255; // opaque
    }
  }
}
writeFileSync(join(OUT, 'tiles.png'), PNG.sync.write(atlas));
console.log(`  wrote assets/tiles.png (${width}x${height}, ${width / 32}x${height / 32} tiles)`);

// Favicon: the game's own Windows program icon (RT_GROUP_ICON in CHIPS.EXE).
{
  ensure(join(ROOT, 'public'));
  const ico = join(TMP, 'chips.ico');
  sh('wrestool', ['-x', '--type=14', exe, '-o', ico]); // assemble the icon group into a .ico
  sh('icotool', ['-x', ico, '-o', join(ROOT, 'public', 'favicon.png')]); // 32x32 -> PNG
  console.log('  wrote public/favicon.png (original program icon)');
}

// --- 1b. Window chrome: info panel, green background, LCD digit font ---
console.log('Extracting window chrome from CHIPS.EXE ...');
ensure(join(OUT, 'chrome'));
const CHROME = [
  ['OBJ_INFOWND', 'INFOWND', 'infownd.png'],
  ['OBJ_BACKGROUND', 'BACKGROUND', 'background.png'],
  ['OBJ_DIGITS', '200', 'digits.png'],
];
for (const [, resName, outName] of CHROME) {
  const bmp = join(TMP, `${outName}.bmp`);
  sh('wrestool', ['-x', '--type=2', `--name=${resName}`, exe, '-o', bmp]);
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', bmp, '-pix_fmt', 'rgba', join(OUT, 'chrome', outName)]);
  console.log(`  chrome ${resName} -> ${outName}`);
}

// --- 2. Level data ---
copyFileSync(join(SRC, 'CHIPS.DAT'), join(OUT, 'levels', 'CHIPS.DAT'));
console.log('  copied CHIPS.DAT');

// --- 3. Sound effects: copy WAV verbatim (tiny 8-bit PCM, browsers play natively) ---
const wavs = readdirSync(SRC).filter((f) => f.toUpperCase().endsWith('.WAV'));
for (const w of wavs) {
  copyFileSync(join(SRC, w), join(OUT, 'sfx', w.toLowerCase()));
  console.log(`  sfx ${w}`);
}

// --- 4. Music: copy MIDI verbatim (synthesized in the browser) ---
const mids = readdirSync(SRC).filter((f) => f.toUpperCase().endsWith('.MID'));
for (const m of mids) {
  copyFileSync(join(SRC, m), join(OUT, 'music', m.toLowerCase()));
  console.log(`  music ${m}`);
}

rmSync(TMP, { recursive: true, force: true });
console.log('Done.');
