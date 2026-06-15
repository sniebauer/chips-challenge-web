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
- **Presentation:** the full original Windows 3.1 window is reproduced — blue title
  bar, Game/Options/Level/Help menu, green circuit-board background, the beveled 9x9
  viewport, and the INFOWND info panel with green 7-segment LCD displays and the
  inventory grid (all art extracted from `CHIPS.EXE`).
- **Audio:** original WAV sound effects, plus the original MIDI music pre-rendered to
  looping OGG/MP3 at build time (see below).
- **Controls:** Arrow keys / WASD, on-screen d-pad + swipe on touch, `R` to restart,
  `P` to enter a level password, `M` to mute. Progress (furthest level, best times)
  is saved to `localStorage`.

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

## Music (build-time)

The original `chip01.mid` / `chip02.mid` are rendered to small looping OGG (+ MP3
fallback) once, at build time, with fluidsynth + a GM soundfont — so the browser
ships no synth or soundfont. The generated `public/music/*.{ogg,mp3}` are committed.
To regenerate:

```bash
brew install fluid-synth                 # one-time
# put a GM soundfont at tools/soundfonts/gm.sf2 (dev-only, gitignored)
npm run gen-music
```

## MS-fidelity regression test

`test/tws-regression.test.ts` replays the canonical public CC1 **MS solution set**
(`assets/solutions/public_chips.dac.tws`, parsed by `src/engine/tws.ts`) through the
engine and checks each level is solved. It is the objective measure of engine
accuracy and guards against regressions. The engine currently replays **109 of 141**
keyboard solutions to a win; the remaining gaps are individual MS quirks (below).

## Status / roadmap

- ✅ DAT parser (all 149 levels, passwords verified against the shipped list)
- ✅ **MS engine: a faithful 20-ticks/sec port of Tile World's mslogic.c** — Chip +
  creatures (correct move order, wall-following, half-speed teeth/blobs, exact
  creature AI), items/doors/boots, ice/force with the slip list + force-floor
  override, blocks, bombs, traps, cloners, toggle walls, teleports, thief.
- ✅ **Bit-exact MS PRNG** (TW's LCG + permutations) for deterministic blob/walker/
  random-force levels.
- ✅ Full Windows 3.1 window chrome + INFOWND panel with LCD displays
- ✅ Renderer, keyboard + touch input, sound effects + music, title/password UI, save
- ✅ TWS solution-replay regression harness (109/141 keyboard solutions pass)
- ⏳ The remaining ~30 replay failures are individual MS quirks: exact slide-delay
  move ordering, block "slap"/mutant-block cases, and deferred button pushes.
- ⏳ Lynx ruleset toggle (the `Ruleset` interface is the seam).
```
