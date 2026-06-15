import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDat, type Level } from '../src/engine/dat';
import { parseTws, TWS_SIG, type TwsSolution } from '../src/engine/tws';
import { initState } from '../src/engine/state';
import { msRuleset } from '../src/engine/logic-ms';
import { Dir, type Direction } from '../src/engine/tiles';

const here = dirname(fileURLToPath(import.meta.url));
const datBuf = new Uint8Array(readFileSync(join(here, '..', 'assets', 'levels', 'CHIPS.DAT')));
const twsBuf = new Uint8Array(readFileSync(join(here, '..', 'assets', 'solutions', 'public_chips.dac.tws')));

const set = parseDat(datBuf);
const tws = parseTws(twsBuf);
const byNumber = new Map<number, Level>(set.levels.map((l) => [l.number, l]));

const DIR: Record<number, Direction> = { 0: Dir.N, 1: Dir.W, 2: Dir.S, 3: Dir.E };

function replay(level: Level, sol: TwsSolution): boolean {
  const state = initState(level, sol.rndSeed);
  const inputs: (Direction | null)[] = []; // indexed by absolute tick
  let maxTick = 0;
  for (const m of sol.moves) {
    inputs[m.tick] = DIR[m.dirIndex]!;
    if (m.tick > maxTick) maxTick = m.tick;
  }
  const limit = Math.max(maxTick, sol.totalTicks) + 400; // ticks; slack for final slides
  for (let t = 0; t <= limit && state.status === 'playing'; t++) {
    msRuleset.advanceTick(state, { dir: inputs[t] ?? null });
  }
  return state.status === 'won';
}

describe('TWS solution replay (MS fidelity)', () => {
  it('parses the MS solution file with 149 solutions', () => {
    expect(parseTws(twsBuf).ruleset).toBe(2); // MS
    expect(tws.solutions.length).toBe(149);
    // sanity on the parser itself
    expect(TWS_SIG).toBe(0x999b3335);
  });

  it('every solution password matches our CHIPS.DAT edition', () => {
    for (const s of tws.solutions) {
      const lv = byNumber.get(s.number);
      expect(lv, `level ${s.number}`).toBeDefined();
      expect(s.password, `level ${s.number} password`).toBe(lv!.password);
    }
  });

  it('replays recorded MS solutions and reports engine fidelity', () => {
    const solved: number[] = [];
    const failed: number[] = [];
    const skipped: number[] = [];
    for (const s of tws.solutions) {
      const lv = byNumber.get(s.number)!;
      if (!s.orthogonalOnly || s.stepping !== 0) {
        skipped.push(s.number);
        continue;
      }
      if (replay(lv, s)) solved.push(s.number);
      else failed.push(s.number);
    }
    const total = solved.length + failed.length;
    // eslint-disable-next-line no-console
    console.log(
      `\nTWS replay: ${solved.length}/${total} replayable levels solved` +
        (skipped.length ? ` (${skipped.length} skipped: mouse/odd-step)` : '') +
        `\n  solved: ${solved.join(',')}` +
        `\n  failed: ${failed.join(',')}` +
        `\n  (remaining gaps are individual MS quirks: exact slide-delay ordering,` +
        `\n   block "slap"/mutant cases, deferred button pushes, etc.)`,
    );
    // Regression guards: the early lessons must always replay, and the overall
    // solved count must not drop below the established baseline.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(solved, `LESSON ${n} should replay to a win`).toContain(n);
    }
    expect(solved.length, 'MS replay fidelity regressed below baseline').toBeGreaterThanOrEqual(105);
  });
});
