import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDat } from '../src/engine/dat';
import { initState } from '../src/engine/state';
import { msRuleset } from '../src/engine/logic-ms';
import { Dir, type Direction } from '../src/engine/tiles';

const here = dirname(fileURLToPath(import.meta.url));
const set = parseDat(new Uint8Array(readFileSync(join(here, '..', 'assets', 'levels', 'CHIPS.DAT'))));

describe('MS ruleset engine', () => {
  it('steps every level for many turns without throwing', () => {
    const dirs: (Direction | null)[] = [null, Dir.N, Dir.E, Dir.S, Dir.W];
    for (const level of set.levels) {
      const state = initState(level, 12345); // fixed seed for determinism
      for (let t = 0; t < 120; t++) {
        const dir = dirs[t % dirs.length]!;
        expect(() => msRuleset.stepTurn(state, { dir })).not.toThrow();
        expect(['playing', 'won', 'lost']).toContain(state.status);
        if (state.status !== 'playing') break;
      }
    }
  });

  it('LESSON 1: collecting a chip decrements the counter', () => {
    const l1 = set.levels[0]!;
    const state = initState(l1, 1);
    const before = state.chipsLeft;
    // Walk down repeatedly; LESSON 1 has chips below Chip's start.
    for (let t = 0; t < 8 && state.status === 'playing'; t++) {
      msRuleset.stepTurn(state, { dir: Dir.S });
    }
    expect(state.chipsLeft).toBeLessThan(before);
  });

  it('untimed levels report no time limit', () => {
    const untimed = set.levels.filter((l) => l.timeLimit === 0);
    for (const l of untimed.slice(0, 5)) {
      const state = initState(l);
      expect(state.timeLeft).toBe(-1);
    }
  });
});
