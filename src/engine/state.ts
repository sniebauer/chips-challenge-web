// Live game state for the MS ruleset (20-ticks/sec model, ported from Tile
// World's mslogic.c). Spatial model: a static `terrain` grid (lower layer) plus
// Mob objects for Chip, monsters and blocks. A slip list drives ice/force sliding.

import type { Level } from './dat';
import { MAP_W, MAP_H, MAP_AREA } from './dat';
import { MsRandom } from './random-ms';
import {
  TILE,
  Dir,
  type Direction,
  type TileCode,
  isCreatureCode,
  isChipCode,
  isBlockCode,
  creatureBase,
  creatureDir,
} from './tiles';

export { MAP_W, MAP_H, MAP_AREA };

// Creature-state flags (CS_* in mslogic.c).
export const CS_SLIP = 1 << 0; // on the slip list (ice or, for creatures, force)
export const CS_SLIDE = 1 << 1; // Chip on a force floor (can override the slide)
export const CS_HASMOVED = 1 << 2; // already moved this 1/5s window
export const CS_TURNING = 1 << 3;
export const CS_RELEASED = 1 << 4; // released from a bear trap
export const CS_CLONING = 1 << 5; // a freshly cloned creature (skip its first move)

export type MobKind = 'chip' | 'monster' | 'block';

export interface Mob {
  pos: number;
  dir: Direction;
  /** Species base code (BUG_N..), TILE.BLOCK, or TILE.CHIP. */
  id: TileCode;
  kind: MobKind;
  dead: boolean;
  state: number; // CS_* flags
  tdir: Direction | null; // direction chosen this tick
}

export interface SlipEntry {
  mob: Mob;
  dir: Direction;
}

export interface CloneTemplate {
  id: TileCode;
  dir: Direction;
  kind: MobKind;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameState {
  level: Level;
  terrain: Uint8Array;
  chip: Mob;
  chipWait: number;
  chipsLeft: number;
  keys: [number, number, number, number]; // blue, red, green, yellow
  boots: [boolean, boolean, boolean, boolean]; // water, fire, ice, force
  /** Monsters then blocks, in MS move order. */
  mobs: Mob[];
  slips: SlipEntry[];
  clones: Map<number, CloneTemplate>;
  /** Clone-machine cells currently producing a clone (FS_CLONING). */
  cloning: Set<number>;
  trapLinks: Map<number, number[]>;
  clonerLinks: Map<number, number[]>;
  openTraps: Set<number>;
  rng: MsRandom;
  status: GameStatus;
  deathCause: string;
  /** 20-ticks/sec master clock. */
  currentTime: number;
  stepping: number;
  /** Last forced-slide direction Chip experienced (for teleport-onto-block). */
  lastSlipDir: Direction | null;
  /** MS mouse-walk goal cell (packed idx), or -1 when none. */
  mouseGoal: number;
  /** Whole seconds left; -1 when untimed. */
  timeLeft: number;
  sounds: string[];
}

/** Canonical sound-effect event names emitted by the ruleset. */
export const SND = {
  CHIP: 'chip', ITEM: 'item', DOOR: 'door', BUMP: 'bump', BUTTON: 'button',
  TELEPORT: 'teleport', WATER: 'water', BOMB: 'bomb', DIE: 'die', WIN: 'win', SOCKET: 'socket',
} as const;

export const keyColorIndex: Record<number, number> = {
  [TILE.KEY_BLUE]: 0, [TILE.KEY_RED]: 1, [TILE.KEY_GREEN]: 2, [TILE.KEY_YELLOW]: 3,
  [TILE.DOOR_BLUE]: 0, [TILE.DOOR_RED]: 1, [TILE.DOOR_GREEN]: 2, [TILE.DOOR_YELLOW]: 3,
};
export const bootIndex: Record<number, number> = {
  [TILE.BOOTS_WATER]: 0, [TILE.BOOTS_FIRE]: 1, [TILE.BOOTS_ICE]: 2, [TILE.BOOTS_FORCE]: 3,
};

export function idx(x: number, y: number): number {
  return y * MAP_W + x;
}
export function tx(i: number): number {
  return i % MAP_W;
}
export function ty(i: number): number {
  return Math.floor(i / MAP_W);
}
export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < MAP_W && y >= 0 && y < MAP_H;
}

export function initState(level: Level, seed?: number): GameState {
  const terrain = new Uint8Array(MAP_AREA);
  const clones = new Map<number, CloneTemplate>();
  const activeMonsters = new Map<number, Mob>();
  let chip: Mob = { pos: 0, dir: Dir.S, id: TILE.CHIP, kind: 'chip', dead: false, state: 0, tdir: null };

  for (let i = 0; i < MAP_AREA; i++) {
    const upper = level.top[i]! as TileCode;
    const lower = level.bottom[i]! as TileCode;

    if (isChipCode(upper)) {
      chip = { pos: i, dir: (upper - TILE.CHIP_N) as Direction, id: TILE.CHIP, kind: 'chip', dead: false, state: 0, tdir: null };
      terrain[i] = lower;
    } else if (isBlockCode(upper)) {
      const dir = blockDir(upper);
      if (lower === TILE.CLONE_MACHINE) {
        terrain[i] = TILE.CLONE_MACHINE;
        clones.set(i, { id: TILE.BLOCK, dir, kind: 'block' });
      } else {
        terrain[i] = lower;
        activeMonsters.set(i, { pos: i, dir, id: TILE.BLOCK, kind: 'block', dead: false, state: 0, tdir: null });
      }
    } else if (isCreatureCode(upper)) {
      const base = creatureBase(upper);
      const dir = creatureDir(upper);
      if (lower === TILE.CLONE_MACHINE) {
        terrain[i] = TILE.CLONE_MACHINE;
        clones.set(i, { id: base, dir, kind: 'monster' });
      } else {
        terrain[i] = lower;
        activeMonsters.set(i, { pos: i, dir, id: base, kind: 'monster', dead: false, state: 0, tdir: null });
      }
    } else {
      terrain[i] = upper;
    }
  }

  // Monsters in DAT monster-list order, then any stragglers; blocks appended after.
  const monsters: Mob[] = [];
  const blocks: Mob[] = [];
  const seen = new Set<number>();
  for (const m of level.monsters) {
    const i = idx(m.x, m.y);
    const mob = activeMonsters.get(i);
    if (mob && !seen.has(i)) {
      (mob.kind === 'block' ? blocks : monsters).push(mob);
      seen.add(i);
    }
  }
  for (const [i, mob] of activeMonsters) {
    if (!seen.has(i)) (mob.kind === 'block' ? blocks : monsters).push(mob);
  }

  return {
    level,
    terrain,
    chip,
    chipWait: 0,
    chipsLeft: level.chipsRequired,
    keys: [0, 0, 0, 0],
    boots: [false, false, false, false],
    mobs: [...monsters, ...blocks],
    slips: [],
    clones,
    cloning: new Set<number>(),
    trapLinks: buildLinks(level.trapLinks),
    clonerLinks: buildLinks(level.clonerLinks),
    openTraps: new Set<number>(),
    rng: new MsRandom(seed),
    status: 'playing',
    deathCause: '',
    currentTime: 0,
    stepping: 0,
    lastSlipDir: null,
    mouseGoal: -1,
    timeLeft: level.timeLimit > 0 ? level.timeLimit : -1,
    sounds: [],
  };
}

function blockDir(code: TileCode): Direction {
  if (code === TILE.BLOCK) return Dir.N;
  return (code - TILE.BLOCK_N) as Direction;
}

function buildLinks(links: { button: { x: number; y: number }; trap?: { x: number; y: number }; clone?: { x: number; y: number } }[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const l of links) {
    const b = idx(l.button.x, l.button.y);
    const target = l.trap ?? l.clone!;
    const t = idx(target.x, target.y);
    const arr = m.get(b);
    if (arr) arr.push(t);
    else m.set(b, [t]);
  }
  return m;
}
