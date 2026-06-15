#!/usr/bin/env node
// Build-time music: render the original Chip's Challenge MIDIs to small looping
// audio files. This is a manual/dev step (needs fluidsynth + a GM soundfont) — the
// generated public/music/*.{ogg,mp3} are committed so deploys/CI don't need either.
//
//   npm run gen-music
//
// Inputs:  assets/music/chip01.mid, chip02.mid  (original game music)
//          tools/soundfonts/gm.sf2              (dev-only GM soundfont, gitignored)
// Outputs: public/music/chip01.{ogg,mp3}, chip02.{ogg,mp3}

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SF2 = join(ROOT, 'tools', 'soundfonts', 'gm.sf2');
const SRC = join(ROOT, 'assets', 'music');
const OUT = join(ROOT, 'public', 'music');
const TMP = tmpdir();

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

if (!existsSync(SF2)) {
  console.error(`Missing GM soundfont at ${SF2}. Place a *.sf2 there (dev-only, gitignored).`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

for (const name of ['chip01', 'chip02']) {
  const mid = join(SRC, `${name}.mid`);
  if (!existsSync(mid)) {
    console.warn(`skip ${name}: no ${mid}`);
    continue;
  }
  const wav = join(TMP, `cc-${name}.wav`);
  // Render MIDI -> WAV with the soundfont.
  sh('fluidsynth', ['-ni', '-g', '0.8', '-F', wav, '-r', '44100', SF2, mid]);
  // OGG (Vorbis) primary — ffmpeg's native vorbis encoder needs stereo + experimental.
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '2', '-c:a', 'vorbis', '-strict', 'experimental', '-q:a', '2', join(OUT, `${name}.ogg`)]);
  // MP3 fallback for browsers without Ogg/Vorbis.
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '112k', join(OUT, `${name}.mp3`)]);
  console.log(`  rendered ${name} -> ${name}.ogg + ${name}.mp3`);
}
console.log('Done. Generated files are in public/music/ (commit them).');
