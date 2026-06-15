# Chip's Challenge — Web (MS / Windows edition)

A browser-native, pixel-perfect recreation of the **Windows 3.x version of Chip's
Challenge**. No VM, no DOS emulator, no recompiled binary — a real reimplementation
of the MS game engine in TypeScript that runs the original level data (`CHIPS.DAT`,
149 levels) and renders the original artwork extracted from `CHIPS.EXE`.

- **Engine:** MS (Windows) ruleset — instantaneous moves at 5 turns/sec, the MS
  blob PRNG, teleport bounce-back, ice/force sliding, traps, cloners, toggle walls,
  tank reversal. Structured behind a `Ruleset` interface so a Lynx ruleset can be
  added later behind a toggle.
- **Stack:** vanilla TypeScript + HTML5 Canvas, built with Vite, shipped as static
  files. The production bundle is ~10 kB gzipped.
- **Controls:** Arrow keys / WASD, on-screen d-pad + swipe on touch, `R` to restart,
  `P` to enter a level password. Progress (furthest level, best times) is saved to
  `localStorage`.

## Assets / legal note

The tiles, sounds, and level data are Microsoft/Bridgestone-era copyrighted assets,
extracted from the original game files for fidelity. They live under `assets/` (and
`public/favicon.png`), kept separate and swappable so they can be removed or replaced
with a user-supplied `CHIPS.DAT` if needed. This repo is for preservation/educational
use; do not redistribute the assets where that isn't permitted.

## Project layout

```
assets/            extracted originals (tiles.png, levels/CHIPS.DAT, sfx/*.wav, music/*.mid)
tools/             extract-assets.mjs — rebuilds assets/ from the original game files
src/engine/        dat.ts (parser), tiles.ts, state.ts, ruleset.ts, logic-ms.ts, random-ms.ts
src/render/        atlas.ts, renderer.ts  (9x9 viewport + info panel)
src/input/         keyboard.ts, touch.ts
src/audio/         sfx.ts  (WebAudio)
src/ui/            shell.ts (title/password overlays), save.ts (localStorage)
src/main.ts        asset loading + fixed-timestep game loop + level progression
test/              dat.test.ts (parser), logic-ms.test.ts (engine smoke + behavior)
```

## Rebuilding the assets

The committed `assets/` were produced from the original game files. To regenerate
them, place the originals in `.src_game/extracted/` (unzip the archive.org item):

```
.src_game/extracted/CHIPS.EXE   CHIPS.DAT   *.WAV   *.MID
```

then run:

```bash
npm run extract-assets   # needs: wrestool (icoutils), ffmpeg, pngjs
```

This pulls the `OBJ32_4` color tilesheet + `OBJ32_1` mask from the NE executable,
composites them into a 416×512 RGBA atlas (13×16 tiles of 32px), copies `CHIPS.DAT`,
and copies the sound effects and MIDI music.

## Develop / build / deploy

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # parser + engine tests
npm run build     # static site in dist/
npm run deploy    # build + wrangler pages deploy dist  (Cloudflare Pages)
```

## Status / roadmap

- ✅ DAT parser (all 149 levels, passwords verified against the shipped list)
- ✅ MS engine: Chip + creatures, items/doors/boots, ice/force, bombs, traps,
  cloners, toggle walls, teleports, thief; runs all 149 levels without error
- ✅ Renderer, keyboard + touch input, sound effects, title/password UI, save
- ⏳ Music: original MIDI files are bundled; in-browser MIDI synthesis is a TODO
- ⏳ Lynx ruleset toggle
- ⏳ Broader MS-fidelity regression suite (e.g. validating against `.tws` solutions)
```
