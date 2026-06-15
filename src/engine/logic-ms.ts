// MS (Windows) ruleset implementation.
//
// Model: one logic turn = 1/5 second; every mob and Chip moves at most one tile
// per turn, instantaneously (MS does not animate inter-tile motion). Order each
// turn: resolve tank reversal, recompute pressed buttons (traps), move monsters
// and sliding blocks in monster-list order, then move Chip, then check end state.

import type { Ruleset, MoveInput } from './ruleset';
import {
  type GameState,
  type Mob,
  idx,
  tx,
  ty,
  inBounds,
  keyColorIndex,
  bootIndex,
  SND,
} from './state';
import {
  TILE,
  Dir,
  DX,
  DY,
  back,
  left,
  right,
  type Direction,
  type TileCode,
  isForceFloor,
} from './tiles';

// --- terrain queries -------------------------------------------------------

function isWallLike(t: TileCode): boolean {
  return (
    t === TILE.WALL ||
    t === TILE.INVISIBLE_WALL ||
    t === TILE.HIDDEN_WALL_TEMP ||
    t === TILE.BLUEWALL_REAL ||
    t === TILE.BLUEWALL_FAKE ||
    t === TILE.TOGGLE_CLOSED ||
    t === TILE.CLONE_MACHINE
  );
}

/** Thin-wall / ice-corner edge blocking when leaving `from` heading `dir`. */
function blocksExit(from: TileCode, dir: Direction): boolean {
  switch (from) {
    case TILE.THIN_WALL_N: return dir === Dir.N;
    case TILE.THIN_WALL_W: return dir === Dir.W;
    case TILE.THIN_WALL_S: return dir === Dir.S;
    case TILE.THIN_WALL_E: return dir === Dir.E;
    case TILE.THIN_WALL_SE: return dir === Dir.S || dir === Dir.E;
    case TILE.ICE_SE: return dir === Dir.N || dir === Dir.W; // walls on N,W
    case TILE.ICE_SW: return dir === Dir.N || dir === Dir.E;
    case TILE.ICE_NW: return dir === Dir.S || dir === Dir.E;
    case TILE.ICE_NE: return dir === Dir.S || dir === Dir.W;
    default: return false;
  }
}

/** Thin-wall / ice-corner edge blocking when entering `to` heading `dir`. */
function blocksEntry(to: TileCode, dir: Direction): boolean {
  switch (to) {
    case TILE.THIN_WALL_N: return dir === Dir.S; // crossing its north edge
    case TILE.THIN_WALL_W: return dir === Dir.E;
    case TILE.THIN_WALL_S: return dir === Dir.N;
    case TILE.THIN_WALL_E: return dir === Dir.W;
    case TILE.THIN_WALL_SE: return dir === Dir.N || dir === Dir.W;
    case TILE.ICE_SE: return dir === Dir.S || dir === Dir.E;
    case TILE.ICE_SW: return dir === Dir.S || dir === Dir.W;
    case TILE.ICE_NW: return dir === Dir.N || dir === Dir.W;
    case TILE.ICE_NE: return dir === Dir.N || dir === Dir.E;
    default: return false;
  }
}

function mobAt(state: GameState, pos: number): Mob | null {
  for (const m of state.mobs) if (!m.dead && m.pos === pos) return m;
  return null;
}

// --- can-enter rules -------------------------------------------------------

type Who = 'chip' | 'monster' | 'block';

/** Can `who` move from `fromPos` into the adjacent cell heading `dir`? Pure check. */
function canMove(state: GameState, fromPos: number, dir: Direction, who: Who): boolean {
  const x = tx(fromPos) + DX[dir];
  const y = ty(fromPos) + DY[dir];
  if (!inBounds(x, y)) return false;
  const toPos = idx(x, y);
  const from = state.terrain[fromPos]! as TileCode;
  const to = state.terrain[toPos]! as TileCode;

  if (blocksExit(from, dir)) return false;
  if (blocksEntry(to, dir)) return false;

  if (who === 'chip') return chipCanEnter(state, to);
  if (who === 'block') return blockCanEnter(state, toPos, to);
  return monsterCanEnter(state, toPos, to);
}

function chipCanEnter(state: GameState, to: TileCode): boolean {
  if (to === TILE.WALL || to === TILE.INVISIBLE_WALL || to === TILE.HIDDEN_WALL_TEMP) return false;
  if (to === TILE.BLUEWALL_REAL || to === TILE.TOGGLE_CLOSED || to === TILE.CLONE_MACHINE) return false;
  if (to === TILE.SOCKET) return state.chipsLeft <= 0;
  if (to === TILE.DOOR_BLUE || to === TILE.DOOR_RED || to === TILE.DOOR_GREEN || to === TILE.DOOR_YELLOW) {
    return state.keys[keyColorIndex[to]!]! > 0;
  }
  return true; // water/fire/etc. enterable; consequences handled on arrival
}

function blockCanEnter(state: GameState, toPos: number, to: TileCode): boolean {
  if (isWallLike(to) && to !== TILE.BLUEWALL_FAKE) return false;
  if (to === TILE.DIRT || to === TILE.FIRE) return false; // blocks can't sit on dirt; fire blocks them in MS
  if (to >= TILE.DOOR_BLUE && to <= TILE.DOOR_YELLOW) return false;
  if (to === TILE.SOCKET || to === TILE.EXIT || to === TILE.THIEF) return false;
  if (to === TILE.BLUEWALL_FAKE) return false;
  if (mobAt(state, toPos)) return false;
  if (toPos === state.chipPos) return false;
  return true; // water (=> dirt), bomb, floor, ice, force, clone target handled on arrival
}

function monsterCanEnter(state: GameState, toPos: number, to: TileCode): boolean {
  if (isWallLike(to)) return false;
  if (to === TILE.DIRT || to === TILE.GRAVEL) return false;
  if (to >= TILE.DOOR_BLUE && to <= TILE.DOOR_YELLOW) return false;
  if (to === TILE.SOCKET || to === TILE.EXIT) return false;
  if (to === TILE.WATER || to === TILE.FIRE) return false; // species immunity handled by caller
  if (mobAt(state, toPos)) return false;
  return true; // Chip's cell is enterable (kills Chip); bomb enterable (kills monster)
}

/** Water/fire are walls to monsters except for their immune species. */
function speciesPasses(id: TileCode, t: TileCode): boolean {
  if (t === TILE.WATER) return id === TILE.GLIDER_N;
  if (t === TILE.FIRE) return id === TILE.FIREBALL_N;
  return true;
}

// --- Chip movement ---------------------------------------------------------

function tryMoveChip(state: GameState, dir: Direction): boolean {
  state.chipDir = dir;
  const x = tx(state.chipPos) + DX[dir];
  const y = ty(state.chipPos) + DY[dir];
  if (!inBounds(x, y)) return false;
  const toPos = idx(x, y);
  const from = state.terrain[state.chipPos]! as TileCode;
  const to = state.terrain[toPos]! as TileCode;
  if (blocksExit(from, dir) || blocksEntry(to, dir)) return false;

  // Pushing a block.
  const occupant = mobAt(state, toPos);
  if (occupant) {
    if (occupant.kind === 'block') {
      if (!canMove(state, toPos, dir, 'block')) return false;
      moveMob(state, occupant, dir); // push it one tile
      if (mobAt(state, toPos)) return false; // block didn't actually vacate
    } else {
      // Walking into a monster: Chip dies.
      if (chipCanEnter(state, to)) {
        leaveChipTile(state, from);
        state.chipPos = toPos;
        die(state, 'A monster got you!');
      }
      return false;
    }
  }

  // Bumping a hidden or real blue wall reveals it as a solid wall and blocks the step.
  if (to === TILE.HIDDEN_WALL_TEMP || to === TILE.BLUEWALL_REAL) {
    state.terrain[toPos] = TILE.WALL;
    return false;
  }
  // A fake blue wall vanishes and Chip enters it in the same move.
  if (to === TILE.BLUEWALL_FAKE) {
    state.terrain[toPos] = TILE.FLOOR;
    leaveChipTile(state, from);
    state.chipPos = toPos;
    return true;
  }

  if (!chipCanEnter(state, to)) return false;

  leaveChipTile(state, from);
  state.chipPos = toPos;
  arriveChip(state, toPos);
  return true;
}

function leaveChipTile(state: GameState, from: TileCode): void {
  // Stepping off a pop-up wall seals it.
  if (from === TILE.POPUP_WALL) state.terrain[state.chipPos] = TILE.WALL;
}

function arriveChip(state: GameState, pos: number): void {
  const t = state.terrain[pos]! as TileCode;
  switch (t) {
    case TILE.CHIP:
      state.chipsLeft = Math.max(0, state.chipsLeft - 1);
      state.terrain[pos] = TILE.FLOOR;
      state.sounds.push(SND.CHIP);
      break;
    case TILE.KEY_BLUE: case TILE.KEY_RED: case TILE.KEY_GREEN: case TILE.KEY_YELLOW:
      state.keys[keyColorIndex[t]!]!++;
      state.terrain[pos] = TILE.FLOOR;
      state.sounds.push(SND.ITEM);
      break;
    case TILE.BOOTS_WATER: case TILE.BOOTS_FIRE: case TILE.BOOTS_ICE: case TILE.BOOTS_FORCE:
      state.boots[bootIndex[t]!] = true;
      state.terrain[pos] = TILE.FLOOR;
      state.sounds.push(SND.ITEM);
      break;
    case TILE.DOOR_BLUE: case TILE.DOOR_RED: case TILE.DOOR_YELLOW: {
      // Colored keys (except green) are consumed opening their door.
      state.keys[keyColorIndex[t]!]!--;
      state.terrain[pos] = TILE.FLOOR;
      state.sounds.push(SND.DOOR);
      break;
    }
    case TILE.DOOR_GREEN:
      state.terrain[pos] = TILE.FLOOR; // green key is reusable
      state.sounds.push(SND.DOOR);
      break;
    case TILE.WATER:
      if (!state.boots[0]) { die(state, 'Ooops! Chip cannot swim without flippers!'); state.sounds.push(SND.WATER); }
      break;
    case TILE.FIRE:
      if (!state.boots[1]) die(state, 'Ooops! Chip cannot walk on fire without fire boots!');
      break;
    case TILE.BOMB:
      state.terrain[pos] = TILE.FLOOR;
      die(state, 'Ooops! Don’t step on the bomb!');
      state.sounds.push(SND.BOMB);
      break;
    case TILE.DIRT:
      state.terrain[pos] = TILE.FLOOR;
      break;
    case TILE.THIEF:
      state.boots = [false, false, false, false];
      state.sounds.push(SND.BUTTON);
      break;
    case TILE.SOCKET:
      state.terrain[pos] = TILE.FLOOR;
      state.sounds.push(SND.SOCKET);
      break;
    case TILE.EXIT:
      state.status = 'won';
      state.sounds.push(SND.WIN);
      break;
    case TILE.BUTTON_GREEN:
      toggleWalls(state);
      state.sounds.push(SND.BUTTON);
      break;
    case TILE.BUTTON_BLUE:
      state.reverseTanks = true;
      state.sounds.push(SND.BUTTON);
      break;
    case TILE.BUTTON_RED:
      fireClones(state, pos);
      state.sounds.push(SND.BUTTON);
      break;
    case TILE.BUTTON_BROWN:
      state.sounds.push(SND.BUTTON);
      break;
    case TILE.TELEPORT:
      teleport(state, 'chip');
      state.sounds.push(SND.TELEPORT);
      break;
    default:
      break;
  }
}

// --- mob movement ----------------------------------------------------------

/** Move a mob one tile in dir (assumes already validated). Applies arrival effects. */
function moveMob(state: GameState, mob: Mob, dir: Direction): void {
  mob.dir = dir;
  const fromTile = state.terrain[mob.pos]! as TileCode;
  if (fromTile === TILE.POPUP_WALL) state.terrain[mob.pos] = TILE.WALL;
  const toPos = idx(tx(mob.pos) + DX[dir], ty(mob.pos) + DY[dir]);
  mob.pos = toPos;
  const to = state.terrain[toPos]! as TileCode;

  if (mob.kind === 'block') {
    if (to === TILE.WATER) {
      state.terrain[toPos] = TILE.DIRT;
      mob.dead = true;
      return;
    }
    if (to === TILE.BOMB) {
      state.terrain[toPos] = TILE.FLOOR;
      mob.dead = true;
      return;
    }
    if (to === TILE.BUTTON_BROWN) { /* traps recomputed each turn */ }
    if (to === TILE.BUTTON_RED) fireClones(state, toPos);
    if (to === TILE.BUTTON_BLUE) state.reverseTanks = true;
    if (to === TILE.BUTTON_GREEN) toggleWalls(state);
    if (to === TILE.TELEPORT) teleport(state, mob);
    return;
  }

  // monster
  if (to === TILE.BOMB) {
    state.terrain[toPos] = TILE.FLOOR;
    mob.dead = true;
    return;
  }
  if (to === TILE.TELEPORT) teleport(state, mob);
  if (toPos === state.chipPos) die(state, 'A monster got you!');
}

/** Whether a mob standing on its tile is forced to slide, and in what direction. */
function slideDir(state: GameState, mob: Mob): Direction | null {
  const t = state.terrain[mob.pos]! as TileCode;
  switch (t) {
    case TILE.ICE: return mob.dir;
    case TILE.ICE_SE: case TILE.ICE_SW: case TILE.ICE_NW: case TILE.ICE_NE:
      return iceCornerRedirect(t, mob.dir);
    case TILE.FORCE_N: return Dir.N;
    case TILE.FORCE_S: return Dir.S;
    case TILE.FORCE_E: return Dir.E;
    case TILE.FORCE_W: return Dir.W;
    case TILE.FORCE_RANDOM: return state.rng.range(4) as Direction;
    default: return null;
  }
}

function iceCornerRedirect(corner: TileCode, dir: Direction): Direction {
  switch (corner) {
    case TILE.ICE_SE: return dir === Dir.N ? Dir.E : dir === Dir.W ? Dir.S : dir;
    case TILE.ICE_SW: return dir === Dir.N ? Dir.W : dir === Dir.E ? Dir.S : dir;
    case TILE.ICE_NW: return dir === Dir.S ? Dir.W : dir === Dir.E ? Dir.N : dir;
    case TILE.ICE_NE: return dir === Dir.S ? Dir.E : dir === Dir.W ? Dir.N : dir;
    default: return dir;
  }
}

// --- monster AI ------------------------------------------------------------

/** Ordered list of directions a monster prefers, by species. Tries each in order. */
function monsterChoices(state: GameState, mob: Mob): Direction[] {
  const d = mob.dir;
  switch (mob.id) {
    case TILE.BUG_N: // follows left wall
      return [left(d), d, right(d), back(d)];
    case TILE.PARAMECIUM_N: // follows right wall
      return [right(d), d, left(d), back(d)];
    case TILE.GLIDER_N: // straight, then left, right, back
      return [d, left(d), right(d), back(d)];
    case TILE.FIREBALL_N: // straight, then right, left, back
      return [d, right(d), left(d), back(d)];
    case TILE.BALL_N: // bounce: straight then reverse
      return [d, back(d)];
    case TILE.WALKER_N: // straight, else the other three in random order
      return [d, ...shuffle3(state, [left(d), back(d), right(d)])];
    case TILE.TANK_N: // straight only (until reversed by blue button)
      return [d];
    case TILE.TEETH_N: // homes toward Chip
      return teethChoices(state, mob);
    case TILE.BLOB_N: // all four directions in random order
      return shuffle4(state, [d, left(d), back(d), right(d)]);
    default:
      return [d];
  }
}

function teethChoices(state: GameState, mob: Mob): Direction[] {
  const dxv = tx(state.chipPos) - tx(mob.pos);
  const dyv = ty(state.chipPos) - ty(mob.pos);
  const horiz: Direction = dxv < 0 ? Dir.W : Dir.E;
  const vert: Direction = dyv < 0 ? Dir.N : Dir.S;
  // Prefer the axis with greater distance (MS teeth behavior).
  if (Math.abs(dxv) > Math.abs(dyv)) return dxv !== 0 ? [horiz, vert] : [vert];
  return dyv !== 0 ? [vert, horiz] : [horiz];
}

function shuffle3(state: GameState, a: Direction[]): Direction[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = state.rng.range(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function shuffle4(state: GameState, a: Direction[]): Direction[] {
  return shuffle3(state, a);
}

function moveOneMonster(state: GameState, mob: Mob): void {
  // Forced sliding takes priority.
  const slide = slideDir(state, mob);
  if (slide !== null) {
    if (tryStep(state, mob, slide)) return;
    // Bounced: reverse on ice, stop on force.
    const t = state.terrain[mob.pos]! as TileCode;
    if (t === TILE.ICE || (t >= TILE.ICE_SE && t <= TILE.ICE_NE)) {
      const b = back(slide);
      mob.dir = b;
      tryStep(state, mob, b);
    }
    return;
  }

  if (mob.kind === 'block') return; // blocks only move when pushed or sliding

  // Teeth and blobs move at half speed (every other turn).
  if ((mob.id === TILE.TEETH_N || mob.id === TILE.BLOB_N) && ((state.tick - 1) & 1) !== 0) return;

  // Trapped monsters can't move unless their trap is currently open.
  if (state.terrain[mob.pos] === TILE.TRAP && !isTrapOpen(state, mob.pos)) return;

  const choices = monsterChoices(state, mob);
  for (const dir of choices) {
    if (canStep(state, mob, dir)) {
      mob.dir = dir;
      tryStep(state, mob, dir);
      return;
    }
  }
  // Nothing available: keep facing the same way (it will retry next turn).
}

function canStep(state: GameState, mob: Mob, dir: Direction): boolean {
  const x = tx(mob.pos) + DX[dir];
  const y = ty(mob.pos) + DY[dir];
  if (!inBounds(x, y)) return false;
  const toPos = idx(x, y);
  const to = state.terrain[toPos]! as TileCode;
  if (!speciesPasses(mob.id, to)) return false;
  return canMove(state, mob.pos, dir, mob.kind === 'block' ? 'block' : 'monster');
}

function tryStep(state: GameState, mob: Mob, dir: Direction): boolean {
  if (!canStep(state, mob, dir)) return false;
  moveMob(state, mob, dir);
  return true;
}

// --- buttons / traps / clones / toggles ------------------------------------

function isTrapOpen(state: GameState, trapPos: number): boolean {
  return state.openTraps.has(trapPos);
}

function recomputeTraps(state: GameState): void {
  state.openTraps.clear();
  for (const [button, traps] of state.trapLinks) {
    const pressed = state.chipPos === button || !!mobAt(state, button);
    if (pressed) for (const t of traps) state.openTraps.add(t);
  }
}

function toggleWalls(state: GameState): void {
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] === TILE.TOGGLE_CLOSED) state.terrain[i] = TILE.TOGGLE_OPEN;
    else if (state.terrain[i] === TILE.TOGGLE_OPEN) state.terrain[i] = TILE.TOGGLE_CLOSED;
  }
}

function fireClones(state: GameState, buttonPos: number): void {
  const targets = state.clonerLinks.get(buttonPos);
  if (!targets) return;
  for (const cell of targets) {
    const tmpl = state.clones.get(cell);
    if (!tmpl) continue;
    const dir = tmpl.dir;
    const x = tx(cell) + DX[dir];
    const y = ty(cell) + DY[dir];
    if (!inBounds(x, y)) continue;
    const ahead = idx(x, y);
    if (mobAt(state, ahead) || ahead === state.chipPos) continue;
    const to = state.terrain[ahead]! as TileCode;
    const who: Who = tmpl.kind === 'block' ? 'block' : 'monster';
    if (!speciesPasses(tmpl.id, to)) continue;
    if (!canMove(state, cell, dir, who)) continue;
    const clone: Mob = { pos: cell, dir, id: tmpl.id, kind: tmpl.kind, dead: false, sliding: false };
    state.mobs.push(clone);
    moveMob(state, clone, dir);
  }
}

function teleport(state: GameState, who: Mob | 'chip'): void {
  const pos = who === 'chip' ? state.chipPos : who.pos;
  const dir = who === 'chip' ? state.chipDir : who.dir;
  // Collect teleport cells in reverse reading order (MS scans backward).
  const teleports: number[] = [];
  for (let i = 0; i < state.terrain.length; i++) if (state.terrain[i] === TILE.TELEPORT) teleports.push(i);
  if (teleports.length === 0) return;
  let k = teleports.indexOf(pos);
  if (k < 0) return;
  for (let n = 1; n <= teleports.length; n++) {
    const cand = teleports[(k - n + teleports.length * n) % teleports.length]!;
    const x = tx(cand) + DX[dir];
    const y = ty(cand) + DY[dir];
    if (!inBounds(x, y)) continue;
    const ahead = idx(x, y);
    const blocked = mobAt(state, ahead) || ahead === (who === 'chip' ? -1 : state.chipPos);
    const okTerrain =
      who === 'chip'
        ? chipCanEnter(state, state.terrain[ahead]! as TileCode)
        : canMove(state, cand, dir, who.kind === 'block' ? 'block' : 'monster');
    if (!blocked && okTerrain) {
      if (who === 'chip') state.chipPos = cand;
      else who.pos = cand;
      return;
    }
  }
}

// --- end conditions --------------------------------------------------------

function die(state: GameState, cause: string): void {
  if (state.status === 'playing') {
    state.status = 'lost';
    state.deathCause = cause;
    state.sounds.push(SND.DIE);
  }
}

// --- the ruleset -----------------------------------------------------------

export const msRuleset: Ruleset = {
  name: 'ms',
  turnsPerSecond: 5,

  stepTurn(state: GameState, input: MoveInput): void {
    if (state.status !== 'playing') return;
    state.tick++;

    // Timer (one displayed second per 5 turns).
    if (state.timeLeft >= 0 && state.tick % this.turnsPerSecond === 0) {
      state.timeLeft--;
      if (state.timeLeft <= 0) {
        die(state, 'Ooops! Out of time!');
        return;
      }
    }

    // Tank reversal queued by a blue button on a previous turn.
    if (state.reverseTanks) {
      for (const m of state.mobs) {
        if (!m.dead && m.id === TILE.TANK_N) m.dir = back(m.dir);
      }
      state.reverseTanks = false;
    }

    // MS order: Chip moves first, then creatures move "at the end of the interval".
    if (input.dir !== null || slideDir(state, fakeChipMob(state)) !== null) {
      stepChip(state, input.dir);
    }
    if (state.status !== 'playing') return;

    // Buttons Chip just pressed affect this turn's creature moves.
    recomputeTraps(state);

    // Move monsters and sliding blocks in monster-list order. Snapshot length so
    // clones made this turn don't also move this turn.
    const count = state.mobs.length;
    for (let i = 0; i < count; i++) {
      const m = state.mobs[i]!;
      if (m.dead) continue;
      if (m.kind === 'block') {
        if (slideDir(state, m) !== null) moveOneMonster(state, m);
      } else {
        moveOneMonster(state, m);
      }
      if (state.status !== 'playing') return;
    }

    // A creature that moved onto Chip's cell kills him.
    const onChip = mobAt(state, state.chipPos);
    if (onChip && onChip.kind === 'monster') die(state, 'A monster got you!');

    // Drop dead mobs occasionally to keep the list small.
    if (state.mobs.length > 256) state.mobs = state.mobs.filter((m) => !m.dead);
  },
};

/** Chip's forced-slide handling reuses slideDir via a lightweight shim. */
function fakeChipMob(state: GameState): Mob {
  return { pos: state.chipPos, dir: state.chipDir, id: TILE.CHIP_N, kind: 'monster', dead: false, sliding: false };
}

function stepChip(state: GameState, inputDir: Direction | null): void {
  const onTile = state.terrain[state.chipPos]! as TileCode;
  const forced = chipForcedSlide(state, onTile);

  if (forced !== null) {
    const hasBoots =
      (onTile === TILE.ICE || (onTile >= TILE.ICE_SE && onTile <= TILE.ICE_NE)) ? state.boots[2] :
      isForceFloor(onTile) ? state.boots[3] : false;
    if (!hasBoots) {
      // On a force floor MS lets the player override with a voluntary move.
      if (isForceFloor(onTile) && inputDir !== null && inputDir !== back(forced) && tryMoveChip(state, inputDir)) {
        return;
      }
      if (!tryMoveChip(state, forced)) {
        // Bounced on ice: reverse and try once.
        if (onTile === TILE.ICE || (onTile >= TILE.ICE_SE && onTile <= TILE.ICE_NE)) {
          state.chipDir = back(forced);
        }
      }
      return;
    }
  }

  if (inputDir !== null) {
    if (!tryMoveChip(state, inputDir) && state.status === 'playing') state.sounds.push(SND.BUMP);
  }
}

function chipForcedSlide(state: GameState, onTile: TileCode): Direction | null {
  switch (onTile) {
    case TILE.ICE: return state.chipDir;
    case TILE.ICE_SE: case TILE.ICE_SW: case TILE.ICE_NW: case TILE.ICE_NE:
      return iceCornerRedirect(onTile, state.chipDir);
    case TILE.FORCE_N: return Dir.N;
    case TILE.FORCE_S: return Dir.S;
    case TILE.FORCE_E: return Dir.E;
    case TILE.FORCE_W: return Dir.W;
    case TILE.FORCE_RANDOM: return state.rng.range(4) as Direction;
    default: return null;
  }
}
