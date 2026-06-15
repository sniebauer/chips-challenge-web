#!/usr/bin/env node
// Recovers the original Help content from CHIPS.HLP (the WinHelp file that shipped
// with the game) into bundled assets the in-game Help window can display.
//
// One-time/dev step (the decompiled output is committed, so the build needs neither
// helpdeco nor this tool):
//   1. Build helpdeco (https://github.com/rofl0r/helpdeco) and run:
//        helpdeco CHIPS.HLP        # -> CHIPS.rtf + bm*.bmp
//      then `textutil -convert txt CHIPS.rtf` (macOS) -> CHIPS.txt
//      Put CHIPS.txt + bm*.bmp in .src_game/help_out/.
//   2. npm run extract-help
//
// Outputs: assets/help/help.json  +  assets/help/bm*.png

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.src_game', 'help_out');
const OUT = join(ROOT, 'assets', 'help');

if (!existsSync(join(SRC, 'CHIPS.txt'))) {
  console.error(`Missing ${join(SRC, 'CHIPS.txt')} — decompile CHIPS.HLP first (see header).`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// --- convert the object-icon bitmaps to PNG ---
for (const f of readdirSync(SRC)) {
  if (/^bm\d+\.bmp$/i.test(f)) {
    const out = join(OUT, f.toLowerCase().replace(/\.bmp$/i, '.png'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(SRC, f), '-pix_fmt', 'rgba', out]);
  }
}

// --- parse the decompiled text into topics ---
const raw = readFileSync(join(SRC, 'CHIPS.txt'), 'utf8').replace(/\r/g, '');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Map "<label>TOPICnn" cross-references to topic titles.
const topicTitleByNum = {};
for (const m of raw.matchAll(/([A-Za-z][A-Za-z' ]+?)TOPIC(\d+)/g)) {
  topicTitleByNum[m[2]] = m[1].trim();
}

// Split on the topic markers (#K+$Title and #$title for popups).
const parts = raw.split(/#K?\+?\$/).map((s) => s.trim()).filter(Boolean);
const topics = [];
for (const part of parts) {
  const nl = part.indexOf('\n');
  const title = (nl < 0 ? part : part.slice(0, nl)).trim();
  let body = nl < 0 ? '' : part.slice(nl + 1);
  if (!title) continue;

  const blocks = [];
  for (let line of body.split('\n')) {
    line = line.replace(/\t/g, ' ').trim();
    if (!line) continue;
    // Strip cross-reference markers, keeping the preceding label text.
    line = line.replace(/TOPIC\d+/g, '');
    const gloss = line.match(/^\{bml\s+(bm\d+)\.bmp\}\s*(.*)$/i);
    const bullet = line.match(/^\{bmc\s+bm[12]\.bmp\}\s*(.*)$/i);
    const inlineIcon = line.match(/^\{bmc\s+(bm\d+)\.bmp\}\s*(.*)$/i);
    if (gloss) blocks.push({ kind: 'gloss', icon: gloss[1].toLowerCase(), text: gloss[2] });
    else if (bullet) blocks.push({ kind: 'bullet', text: bullet[1] });
    else if (inlineIcon) blocks.push({ kind: 'icon', icon: inlineIcon[1].toLowerCase(), text: inlineIcon[2] });
    else blocks.push({ kind: 'para', text: line.replace(/\{bm[lc][^}]*\}/g, '').trim() });
  }
  topics.push({ id: slug(title), title, blocks });
}

// Mark which topics are linkable from contents/see-also (by title).
const byTitle = Object.fromEntries(topics.map((t) => [t.title.toLowerCase(), t.id]));
for (const t of topics) {
  for (const b of t.blocks) {
    if (b.kind === 'para' && byTitle[b.text.toLowerCase()] && byTitle[b.text.toLowerCase()] !== t.id) {
      b.kind = 'link';
      b.to = byTitle[b.text.toLowerCase()];
    }
  }
}

writeFileSync(join(OUT, 'help.json'), JSON.stringify({ topics, titleByNum: topicTitleByNum }, null, 1));
console.log(`Wrote assets/help/help.json (${topics.length} topics) + icon PNGs.`);
