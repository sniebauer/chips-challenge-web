// Live game state for the MS ruleset, built from a parsed Level.
// Spatial model: a `terrain` grid (static lower layer) plus an object list of
// mobs (monsters and blocks) and a separately tracked Chip. This reproduces MS
// behavior for the vast majority of levels while staying easy to reason about.

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

export type MobKind = 'monster' | 'block';

export interface Mob {
  pos: number; // cell index
  dir: Direction;
  /** Species base code for monsters (e.g. BUG_N); TILE.BLOCK for blocks. */
  id: TileCode;
  kind: MobKind;
  dead: boolean;
  /** True while sliding on ice / force floor (so it keeps moving). */
  sliding: boolean;
}

export interface CloneTemplate {
  id: TileCode;
  dir: Direction;
  kind: MobKind;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameState {
  level: Level;
  terrain: Uint8Array; // MAP_AREA static terrain (mutated as the world changes)
  chipPos: number;
  /** Direction Chip faces (also used for rendering when standing still). */
  chipDir: Direction;
  chipsLeft: number;
  keys: [number, number, number, number]; // blue, red, green, yellow
  boots: [boolean, boolean, boolean, boolean]; // water, fire, ice, force
  mobs: Mob[];
  /** Clone templates keyed by cell index (creature/block sitting on a clone machine). */
  clones: Map<number, CloneTemplate>;
  trapLinks: Map<number, number[]>; // brown button cell -> trap cells
  clonerLinks: Map<number, number[]>; // red button cell -> clone machine cells
  /** Trap cells currently open (their brown button is pressed this turn). */
  openTraps: Set<number>;
  rng: MsRandom;
  status: GameStatus;
  deathCause: string;
  /** Ticks elapsed at the 20/sec master clock. */
  tick: number;
  /** Whole seconds left (timeLimit countdown); -1 when untimed. */
  timeLeft: number;
  /** Pending tank reversal (blue button pressed). */
  reverseTanks: boolean;
  /** Sound-effect event names queued this turn; drained by the audio layer. */
  sounds: string[];
}

/** Canonical sound-effect event names emitted by the ruleset. */
export const SND = {
  CHIP: 'chip',
  ITEM: 'item',
  DOOR: 'door',
  BUMP: 'bump',
  BUTTON: 'button',
  TELEPORT: 'teleport',
  WATER: 'water',
  BOMB: 'bomb',
  DIE: 'die',
  WIN: 'win',
  SOCKET: 'socket',
} as const;

export const keyColorIndex: Record<number, number> = {
  [TILE.KEY_BLUE]: 0,
  [TILE.KEY_RED]: 1,
  [TILE.KEY_GREEN]: 2,
  [TILE.KEY_YELLOW]: 3,
  [TILE.DOOR_BLUE]: 0,
  [TILE.DOOR_RED]: 1,
  [TILE.DOOR_GREEN]: 2,
  [TILE.DOOR_YELLOW]: 3,
};
export const bootIndex: Record<number, number> = {
  [TILE.BOOTS_WATER]: 0,
  [TILE.BOOTS_FIRE]: 1,
  [TILE.BOOTS_ICE]: 2,
  [TILE.BOOTS_FORCE]: 3,
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
  let chipPos = 0;
  let chipDir: Direction = Dir.S;

  for (let i = 0; i < MAP_AREA; i++) {
    const upper = level.top[i]! as TileCode;
    const lower = level.bottom[i]! as TileCode;

    if (isChipCode(upper)) {
      chipPos = i;
      chipDir = (upper - TILE.CHIP_N) as Direction;
      terrain[i] = lower; // terrain Chip stands on
    } else if (isBlockCode(upper)) {
      if (lower === TILE.CLONE_MACHINE) {
        terrain[i] = TILE.CLONE_MACHINE;
        clones.set(i, { id: TILE.BLOCK, dir: blockDir(upper), kind: 'block' });
      } else {
        terrain[i] = lower;
        activeMonsters.set(i, { pos: i, dir: blockDir(upper), id: TILE.BLOCK, kind: 'block', dead: false, sliding: false });
      }
    } else if (isCreatureCode(upper)) {
      const base = creatureBase(upper);
      const dir = creatureDir(upper);
      if (lower === TILE.CLONE_MACHINE) {
        terrain[i] = TILE.CLONE_MACHINE;
        clones.set(i, { id: base, dir, kind: 'monster' });
      } else {
        terrain[i] = lower;
        activeMonsters.set(i, { pos: i, dir, id: base, kind: 'monster', dead: false, sliding: false });
      }
    } else {
      // Static terrain or item (chip/key/boot) sits directly in the layer.
      terrain[i] = upper;
    }
  }

  // Order monsters per the DAT monster list (MS move order); append any stragglers.
  const mobs: Mob[] = [];
  const seen = new Set<number>();
  for (const m of level.monsters) {
    const i = idx(m.x, m.y);
    const mob = activeMonsters.get(i);
    if (mob && !seen.has(i)) {
      mobs.push(mob);
      seen.add(i);
    }
  }
  for (const [i, mob] of activeMonsters) {
    if (!seen.has(i)) mobs.push(mob);
  }

  const chipsLeft = level.chipsRequired;

  return {
    level,
    terrain,
    chipPos,
    chipDir,
    chipsLeft,
    keys: [0, 0, 0, 0],
    boots: [false, false, false, false],
    mobs,
    clones,
    trapLinks: buildLinks(level.trapLinks),
    clonerLinks: buildLinks(level.clonerLinks),
    openTraps: new Set<number>(),
    rng: new MsRandom(seed),
    status: 'playing',
    deathCause: '',
    tick: 0,
    timeLeft: level.timeLimit > 0 ? level.timeLimit : -1,
    reverseTanks: false,
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

