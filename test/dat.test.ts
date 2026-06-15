import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDat, MS_MAGIC, MAP_AREA } from '../src/engine/dat';

const here = dirname(fileURLToPath(import.meta.url));
const DAT = join(here, '..', 'assets', 'levels', 'CHIPS.DAT');

const set = parseDat(new Uint8Array(readFileSync(DAT)));

// A few known (level number -> [title, password]) pairs from the shipped password list.
const KNOWN: Record<number, [string, string]> = {
  1: ['LESSON 1', 'BDHP'],
  2: ['LESSON 2', 'JXMJ'],
  9: ['NUTS AND BOLTS', 'KCRE'],
  11: ['TRINITY', 'CNPE'],
  13: ['SOUTHPOLE', 'OCKS'],
};

describe('CHIPS.DAT parser', () => {
  it('reads the MS header with 149 levels', () => {
    expect(set.magic).toBe(MS_MAGIC);
    expect(set.lynx).toBe(false);
    expect(set.levels).toHaveLength(149);
  });

  it('decodes both map layers to 32x32 for every level', () => {
    for (const lv of set.levels) {
      expect(lv.top).toHaveLength(MAP_AREA);
      expect(lv.bottom).toHaveLength(MAP_AREA);
    }
  });

  it('matches known level titles and passwords', () => {
    for (const [num, [title, pw]] of Object.entries(KNOWN)) {
      const lv = set.levels.find((l) => l.number === Number(num));
      expect(lv, `level ${num} present`).toBeDefined();
      expect(lv!.title).toBe(title);
      expect(lv!.password).toBe(pw);
    }
  });

  it('every level has a 4-letter password and a title', () => {
    for (const lv of set.levels) {
      expect(lv.title.length, `level ${lv.number} title`).toBeGreaterThan(0);
      expect(lv.password, `level ${lv.number} password`).toMatch(/^[A-Z]{4}$/);
    }
  });

  it('level 1 (LESSON 1) has the expected chip count and a Chip start tile', () => {
    const l1 = set.levels[0]!;
    expect(l1.title).toBe('LESSON 1');
    // LESSON 1 requires collecting some chips and is untimed.
    expect(l1.chipsRequired).toBeGreaterThan(0);
    // Chip's start (code 0x6C-0x6F) must appear somewhere in the top layer.
    const hasChip = l1.top.some((t) => t >= 0x6c && t <= 0x6f);
    expect(hasChip).toBe(true);
  });
});
