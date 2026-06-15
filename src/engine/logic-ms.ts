// MS (Windows) ruleset — a faithful port of Tile World's mslogic.c at 20 ticks/sec.
//
// Each tick (advanceTick): creatures and floor-slides run on even ticks (gated to
// every 4th by `&2`; teeth/blobs every 8th), then Chip moves. Sliding is driven by
// a slip list; on a force floor a slide clears Chip's HASMOVED so he gets an extra
// voluntary move that tick (the force-floor override that makes >5 moves/sec).

import type { Ruleset, MoveInput } from './ruleset';
import {
  type GameState,
  type Mob,
  CS_SLIP, CS_SLIDE, CS_HASMOVED, CS_TURNING, CS_RELEASED, CS_CLONING,
  SND, idx, tx, ty, inBounds, keyColorIndex, bootIndex,
} from './state';
import { TILE, Dir, DX, DY, back, left, right, type Direction, type TileCode } from './tiles';

const DIRBIT = [1, 2, 4, 8] as const; // N,W,S,E -> TW direction bits

// --- terrain classification ---
function isIce(t: number) { return t === TILE.ICE || (t >= TILE.ICE_SE && t <= TILE.ICE_NE); }
function isForce(t: number) { return t === TILE.FORCE_S || (t >= TILE.FORCE_N && t <= TILE.FORCE_W) || t === TILE.FORCE_RANDOM; }
function isDoor(t: number) { return t >= TILE.DOOR_BLUE && t <= TILE.DOOR_YELLOW; }

/** Allowed entry-direction bitmask for `floor` and mover kind (the movelaws table). */
function movelaw(floor: number, kind: 'chip' | 'block' | 'monster'): number {
  switch (floor) {
    case TILE.WALL: case TILE.INVISIBLE_WALL: case TILE.TOGGLE_CLOSED: case TILE.CLONE_MACHINE:
      return 0;
    case TILE.THIN_WALL_N: return 0b1011; // all but S
    case TILE.THIN_WALL_W: return 0b0111; // all but E
    case TILE.THIN_WALL_S: return 0b1110; // all but N
    case TILE.THIN_WALL_E: return 0b1101; // all but W
    case TILE.THIN_WALL_SE: return 0b1100; // S|E
    case TILE.ICE_NW: return 0b1100; // S|E
    case TILE.ICE_NE: return 0b0110; // S|W
    case TILE.ICE_SW: return 0b1001; // N|E
    case TILE.ICE_SE: return 0b0011; // N|W
    case TILE.DIRT: return kind === 'chip' ? 15 : 0;
    case TILE.GRAVEL: case TILE.FORCE_RANDOM: return kind === 'monster' ? 0 : 15;
    case TILE.DOOR_BLUE: case TILE.DOOR_RED: case TILE.DOOR_GREEN: case TILE.DOOR_YELLOW:
    case TILE.HIDDEN_WALL_TEMP: case TILE.BLUEWALL_REAL: case TILE.BLUEWALL_FAKE: case TILE.POPUP_WALL:
    case TILE.SOCKET: case TILE.CHIP: case TILE.THIEF:
      return kind === 'chip' ? 15 : 0;
    case TILE.EXIT: return kind === 'monster' ? 0 : 15;
    case TILE.BOOTS_WATER: case TILE.BOOTS_FIRE: case TILE.BOOTS_ICE: case TILE.BOOTS_FORCE:
      return kind === 'monster' ? 0 : 15;
    default:
      return 15;
  }
}

function iceCornerRedirect(corner: number, dir: Direction): Direction {
  switch (corner) {
    case TILE.ICE_SE: return dir === Dir.N ? Dir.E : dir === Dir.W ? Dir.S : dir;
    case TILE.ICE_SW: return dir === Dir.N ? Dir.W : dir === Dir.E ? Dir.S : dir;
    case TILE.ICE_NW: return dir === Dir.S ? Dir.W : dir === Dir.E ? Dir.N : dir;
    case TILE.ICE_NE: return dir === Dir.S ? Dir.E : dir === Dir.W ? Dir.N : dir;
    default: return dir;
  }
}

function getSlideDir(state: GameState, floor: number): Direction {
  switch (floor) {
    case TILE.FORCE_N: return Dir.N;
    case TILE.FORCE_W: return Dir.W;
    case TILE.FORCE_S: return Dir.S;
    case TILE.FORCE_E: return Dir.E;
    case TILE.FORCE_RANDOM: return state.rng.random4() as Direction;
    default: return Dir.N;
  }
}

// --- occupancy ---
function mobAt(state: GameState, pos: number): Mob | null {
  for (const m of state.mobs) if (!m.dead && m.pos === pos) return m;
  return null;
}

// --- can-make-move (ported from canmakemove) ---
const CMM_NOLEAVECHECK = 1, CMM_NOEXPOSEWALLS = 2, CMM_NOPUSHING = 4, CMM_NOFIRECHECK = 8, CMM_CLONECANTBLOCK = 16;

function canMakeMove(state: GameState, mob: Mob, dir: Direction, flags: number): boolean {
  const x = tx(mob.pos) + DX[dir];
  const y = ty(mob.pos) + DY[dir];
  if (!inBounds(x, y)) return false;
  const to = idx(x, y);
  const bit = DIRBIT[dir];

  // leave check
  if (!(flags & CMM_NOLEAVECHECK)) {
    const from = state.terrain[mob.pos];
    if (from === TILE.THIN_WALL_N && dir === Dir.N) return false;
    if (from === TILE.THIN_WALL_W && dir === Dir.W) return false;
    if (from === TILE.THIN_WALL_S && dir === Dir.S) return false;
    if (from === TILE.THIN_WALL_E && dir === Dir.E) return false;
    if (from === TILE.THIN_WALL_SE && (dir === Dir.S || dir === Dir.E)) return false;
    if (from === TILE.TRAP && !(mob.state & CS_RELEASED)) return false;
  }

  const floor = state.terrain[to]! as TileCode;
  const occ = mobAt(state, to);

  if (mob.kind === 'chip') {
    if (!(movelaw(floor, 'chip') & bit)) return false;
    if (floor === TILE.SOCKET && state.chipsLeft > 0) return false;
    if (isDoor(floor) && state.keys[keyColorIndex[floor]!]! <= 0) return false;
    if (floor === TILE.HIDDEN_WALL_TEMP || floor === TILE.BLUEWALL_REAL) {
      if (!(flags & CMM_NOEXPOSEWALLS)) state.terrain[to] = TILE.WALL;
      return false;
    }
    if (occ && occ.kind === 'block') {
      // push the block
      if (flags & CMM_NOPUSHING) return false;
      if (!canMakeMove(state, occ, dir, 0)) return false;
      advanceCreature(state, occ, dir);
      return mobAt(state, to) === null; // succeeded only if the block vacated
    }
    return true; // monster on `to` is allowed (Chip collides and dies)
  }

  if (mob.kind === 'block') {
    if (occ) return occ.kind === 'chip'; // a block may only move onto Chip
    if (to === state.chip.pos) return true;
    if (!(movelaw(floor, 'block') & bit)) return false;
  } else {
    if (occ) {
      // a clone is not blocked by an identical creature already in the way
      if ((flags & CMM_CLONECANTBLOCK) && occ.id === mob.id && occ.dir === mob.dir) return true;
      return false; // monster blocked by any mob
    }
    if (!(movelaw(floor, 'monster') & bit)) return false;
    if (floor === TILE.FIRE && (mob.id === TILE.BUG_N || mob.id === TILE.WALKER_N) && !(flags & CMM_NOFIRECHECK))
      return false;
  }
  if (state.terrain[to] === TILE.CLONE_MACHINE) return false;
  return true;
}

// --- start / end movement ---
function startMovement(state: GameState, mob: Mob, dir: Direction): boolean {
  if (!canMakeMove(state, mob, dir, 0)) {
    const floor = state.terrain[mob.pos];
    if (mob.kind === 'chip' || (floor !== TILE.TRAP && floor !== TILE.CLONE_MACHINE && !(mob.state & CS_SLIP))) {
      mob.dir = dir;
    }
    return false;
  }
  mob.state &= ~CS_RELEASED;
  mob.dir = dir;
  return true;
}

function snd(state: GameState, s: string) { state.sounds.push(s); }

function endMovement(state: GameState, mob: Mob, dir: Direction): void {
  const oldpos = mob.pos;
  const newpos = idx(tx(oldpos) + DX[dir], ty(oldpos) + DY[dir]);
  let floor = state.terrain[newpos]! as TileCode;
  let dead = false;

  if (mob.kind === 'chip') {
    switch (floor) {
      case TILE.CHIP: if (state.chipsLeft > 0) state.chipsLeft--; state.terrain[newpos] = TILE.FLOOR; snd(state, SND.CHIP); break;
      case TILE.WATER: if (!state.boots[0]) { state.status = 'lost'; state.deathCause = 'Ooops! Chip cannot swim without flippers!'; snd(state, SND.WATER); snd(state, SND.DIE); } break;
      case TILE.FIRE: if (!state.boots[1]) { state.status = 'lost'; state.deathCause = 'Ooops! Chip cannot walk on fire without fire boots!'; snd(state, SND.DIE); } break;
      case TILE.DIRT: state.terrain[newpos] = TILE.FLOOR; break;
      case TILE.BLUEWALL_FAKE: state.terrain[newpos] = TILE.FLOOR; break;
      case TILE.POPUP_WALL: state.terrain[newpos] = TILE.WALL; break;
      case TILE.DOOR_BLUE: case TILE.DOOR_RED: case TILE.DOOR_YELLOW: state.keys[keyColorIndex[floor]!]!--; state.terrain[newpos] = TILE.FLOOR; snd(state, SND.DOOR); break;
      case TILE.DOOR_GREEN: state.terrain[newpos] = TILE.FLOOR; snd(state, SND.DOOR); break;
      case TILE.KEY_BLUE: case TILE.KEY_RED: case TILE.KEY_GREEN: case TILE.KEY_YELLOW: state.keys[keyColorIndex[floor]!]!++; state.terrain[newpos] = TILE.FLOOR; snd(state, SND.ITEM); break;
      case TILE.BOOTS_WATER: case TILE.BOOTS_FIRE: case TILE.BOOTS_ICE: case TILE.BOOTS_FORCE: state.boots[bootIndex[floor]!] = true; state.terrain[newpos] = TILE.FLOOR; snd(state, SND.ITEM); break;
      case TILE.THIEF: state.boots = [false, false, false, false]; snd(state, SND.BUTTON); break;
      case TILE.SOCKET: state.terrain[newpos] = TILE.FLOOR; snd(state, SND.SOCKET); break;
      case TILE.BOMB: state.terrain[newpos] = TILE.FLOOR; state.status = 'lost'; state.deathCause = 'Ooops! Don’t step on the bomb!'; snd(state, SND.BOMB); snd(state, SND.DIE); break;
      default:
        if (mobAt(state, newpos)) { state.status = 'lost'; state.deathCause = 'A monster got you!'; snd(state, SND.DIE); }
        break;
    }
  } else if (mob.kind === 'block') {
    switch (floor) {
      case TILE.WATER: state.terrain[newpos] = TILE.DIRT; dead = true; snd(state, SND.WATER); break;
      case TILE.BOMB: state.terrain[newpos] = TILE.FLOOR; dead = true; snd(state, SND.BOMB); break;
      case TILE.TELEPORT: break;
    }
  } else {
    switch (floor) {
      case TILE.WATER: if (mob.id !== TILE.GLIDER_N) dead = true; break;
      case TILE.FIRE: if (mob.id !== TILE.FIREBALL_N) dead = true; break;
      case TILE.BOMB: state.terrain[newpos] = TILE.FLOOR; dead = true; snd(state, SND.BOMB); break;
    }
  }

  if (dead) { mob.dead = true; return; }

  mob.pos = newpos;

  if (state.status !== 'playing') return;

  // buttons fire when stepped on
  switch (floor) {
    case TILE.BUTTON_BLUE: turnTanks(state); snd(state, SND.BUTTON); break;
    case TILE.BUTTON_GREEN: toggleWalls(state); break;
    case TILE.BUTTON_RED: activateCloner(state, newpos); snd(state, SND.BUTTON); break;
    case TILE.BUTTON_BROWN: springTrap(state, newpos); snd(state, SND.BUTTON); break;
  }

  // bear-trap release on arrival
  if (floor === TILE.TRAP && state.openTraps.has(newpos)) mob.state |= CS_RELEASED;

  if (mob.kind === 'chip') {
    if (floor === TILE.EXIT) { state.status = 'won'; snd(state, SND.WIN); return; }
  } else if (newpos === state.chip.pos) {
    state.status = 'lost'; state.deathCause = 'A monster got you!'; snd(state, SND.DIE); return;
  }

  // teleport
  if (floor === TILE.TELEPORT) { teleport(state, mob); floor = state.terrain[mob.pos]! as TileCode; snd(state, SND.TELEPORT); }

  // slip setup
  if (floor === TILE.TELEPORT) {
    startFloorMovement(state, mob, floor);
  } else if (isIce(floor) && (mob.kind !== 'chip' || !state.boots[2])) {
    startFloorMovement(state, mob, floor);
  } else if (isForce(floor) && (mob.kind !== 'chip' || !state.boots[3])) {
    startFloorMovement(state, mob, floor);
  } else {
    mob.state &= ~(CS_SLIP | CS_SLIDE);
  }
}

function advanceCreature(state: GameState, mob: Mob, dir: Direction): boolean {
  if (mob.kind === 'chip') state.chipWait = 0;
  if (!startMovement(state, mob, dir)) {
    if (mob.kind === 'chip') snd(state, SND.BUMP);
    return false;
  }
  endMovement(state, mob, dir);
  return true;
}

// --- slip list ---
function appendSlip(state: GameState, mob: Mob, dir: Direction): void {
  state.slips.push({ mob, dir });
}
function prependSlip(state: GameState, mob: Mob, dir: Direction): void {
  state.slips.unshift({ mob, dir });
}
function removeSlip(state: GameState, mob: Mob): void {
  state.slips = state.slips.filter((s) => s.mob !== mob);
}
function startFloorMovement(state: GameState, mob: Mob, floor: number): void {
  mob.state &= ~(CS_SLIP | CS_SLIDE);
  removeSlip(state, mob); // ensure a single slip-list entry per mob
  let dir: Direction;
  if (isIce(floor)) dir = iceCornerRedirect(floor, mob.dir);
  else if (isForce(floor)) dir = getSlideDir(state, floor);
  else if (floor === TILE.TELEPORT) dir = mob.dir;
  else return;

  if (mob.kind === 'chip') {
    mob.state |= isForce(floor) ? CS_SLIDE : CS_SLIP;
    prependSlip(state, mob, dir);
    mob.dir = dir;
  } else {
    mob.state |= CS_SLIP;
    appendSlip(state, mob, dir);
  }
}
function endFloorMovement(state: GameState, mob: Mob): void {
  mob.state &= ~(CS_SLIP | CS_SLIDE);
  removeSlip(state, mob);
}
function updateSlipList(state: GameState): void {
  for (const s of [...state.slips]) {
    if (!(s.mob.state & (CS_SLIP | CS_SLIDE))) endFloorMovement(state, s.mob);
  }
}
function floorMovements(state: GameState): void {
  // Process each mob that is slipping at the start of the tick, in slip-list order.
  const order = state.slips.map((s) => s.mob);
  for (const mob of order) {
    if (mob.dead || !(mob.state & (CS_SLIP | CS_SLIDE))) continue;
    const cur = state.slips.find((s) => s.mob === mob);
    if (!cur) continue;
    let slipdir = cur.dir;
    if (mob.kind === 'chip') state.lastSlipDir = slipdir;
    if (advanceCreature(state, mob, slipdir)) {
      if (mob.kind === 'chip') mob.state &= ~CS_HASMOVED;
    } else {
      const floor = state.terrain[mob.pos]! as TileCode;
      if (isForce(floor)) {
        if (mob.kind === 'chip') mob.state &= ~CS_HASMOVED;
      } else if (isIce(floor)) {
        slipdir = iceCornerRedirect(floor, back(slipdir));
        if (mob.kind === 'chip') state.lastSlipDir = slipdir;
        if (advanceCreature(state, mob, slipdir) && mob.kind === 'chip') mob.state &= ~CS_HASMOVED;
      }
      if (mob.state & (CS_SLIP | CS_SLIDE)) {
        endFloorMovement(state, mob);
        startFloorMovement(state, mob, state.terrain[mob.pos]!);
      }
    }
    if (state.status !== 'playing') return;
  }
}

// --- teleport (scan backward for a usable teleport) ---
function teleport(state: GameState, mob: Mob): void {
  const teleports: number[] = [];
  for (let i = 0; i < state.terrain.length; i++) if (state.terrain[i] === TILE.TELEPORT) teleports.push(i);
  const k = teleports.indexOf(mob.pos);
  if (k < 0 || teleports.length < 2) return;
  const origpos = mob.pos;
  for (let n = 1; n <= teleports.length; n++) {
    const cand = teleports[(k - n + teleports.length * n) % teleports.length]!;
    if (cand === origpos) break;
    mob.pos = cand;
    const ok = canMakeMove(state, mob, mob.dir, CMM_NOLEAVECHECK | CMM_NOEXPOSEWALLS | CMM_NOFIRECHECK);
    if (ok) return;
  }
  mob.pos = origpos;
}

// --- controllers ---
// Guards against pathological button chains (a cloned/sprung creature landing on
// another cloner/trap button and recursing without bound).
let buttonDepth = 0;
const MAX_BUTTON_DEPTH = 64;

function turnTanks(state: GameState): void {
  for (const m of state.mobs) if (!m.dead && m.id === TILE.TANK_N) m.dir = back(m.dir);
}
function toggleWalls(state: GameState): void {
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] === TILE.TOGGLE_CLOSED) state.terrain[i] = TILE.TOGGLE_OPEN;
    else if (state.terrain[i] === TILE.TOGGLE_OPEN) state.terrain[i] = TILE.TOGGLE_CLOSED;
  }
}
function springTrap(state: GameState, buttonPos: number): void {
  // Just release any trapped creature; it moves on its own next creature tick.
  const traps = state.trapLinks.get(buttonPos);
  if (!traps) return;
  for (const t of traps) {
    const m = mobAt(state, t);
    if (m) m.state |= CS_RELEASED;
  }
}
function activateCloner(state: GameState, buttonPos: number): void {
  const targets = state.clonerLinks.get(buttonPos);
  if (!targets || buttonDepth > MAX_BUTTON_DEPTH) return;
  buttonDepth++;
  for (const cell of targets) {
    const tmpl = state.clones.get(cell);
    if (!tmpl) continue;
    if (mobAt(state, cell)) continue; // FS_CLONING: machine still busy
    const dummy: Mob = { pos: cell, dir: tmpl.dir, id: tmpl.id, kind: tmpl.kind, dead: false, state: 0, tdir: null };
    if (!canMakeMove(state, dummy, tmpl.dir, CMM_NOLEAVECHECK | CMM_CLONECANTBLOCK)) continue;
    if (tmpl.kind === 'block') {
      // a cloned block moves off the machine immediately
      state.mobs.push(dummy);
      advanceCreature(state, dummy, tmpl.dir);
    } else {
      // a cloned monster waits on the machine; it moves on a later creature tick
      dummy.state = CS_CLONING;
      state.mobs.push(dummy);
    }
  }
  buttonDepth--;
}

// --- creature move choice ---
function chooseCreatureMove(state: GameState, mob: Mob): void {
  mob.tdir = null;
  if (mob.dead || mob.kind === 'block') return;
  if (state.currentTime & 2) return;
  if ((mob.id === TILE.TEETH_N || mob.id === TILE.BLOB_N) && ((state.currentTime + state.stepping) & 4)) return;
  if (mob.state & CS_TURNING) { mob.state &= ~(CS_TURNING | CS_HASMOVED); }
  if (mob.state & CS_HASMOVED) return;
  if (mob.state & (CS_SLIP | CS_SLIDE)) return;

  const d = mob.dir;
  let pdir: Direction = d; // direction kept if every choice is blocked
  const onController = state.terrain[mob.pos] === TILE.CLONE_MACHINE || state.terrain[mob.pos] === TILE.TRAP;
  let choices: (Direction | null)[];

  if (onController) {
    switch (mob.id) {
      case TILE.TANK_N: case TILE.BALL_N: case TILE.GLIDER_N: case TILE.FIREBALL_N: case TILE.WALKER_N:
        choices = [d]; break;
      case TILE.BLOB_N: { const a = [d, left(d), back(d), right(d)]; state.rng.permute4(a); choices = a; break; }
      default: choices = [d]; break; // bug/paramecium/teeth on cloner keep facing
    }
  } else {
    switch (mob.id) {
      case TILE.TANK_N: choices = [d]; break;
      case TILE.BALL_N: choices = [d, back(d)]; break;
      case TILE.GLIDER_N: choices = [d, left(d), right(d), back(d)]; break;
      case TILE.FIREBALL_N: choices = [d, right(d), left(d), back(d)]; break;
      case TILE.WALKER_N: { const a = [left(d), back(d), right(d)]; state.rng.permute3(a); choices = [d, ...a]; break; }
      case TILE.BLOB_N: { const a = [d, left(d), back(d), right(d)]; state.rng.permute4(a); choices = a; break; }
      case TILE.BUG_N: choices = [left(d), d, right(d), back(d)]; break;
      case TILE.PARAMECIUM_N: choices = [right(d), d, left(d), back(d)]; break;
      case TILE.TEETH_N: { choices = teethChoices(state, mob); pdir = (choices[0] as Direction) ?? d; break; }
      default: choices = [d]; break;
    }
  }

  for (const dir of choices) {
    if (dir === null) continue;
    mob.tdir = dir;
    if (canMakeMove(state, mob, dir, 0)) return;
  }
  // Every option blocked: keep the original facing (teeth keep their primary homing dir).
  mob.tdir = pdir;
}

function teethChoices(state: GameState, mob: Mob): Direction[] {
  const dy = ty(state.chip.pos) - ty(mob.pos);
  const dx = tx(state.chip.pos) - tx(mob.pos);
  const n: Direction | null = dy < 0 ? Dir.N : dy > 0 ? Dir.S : null;
  const m: Direction | null = dx < 0 ? Dir.W : dx > 0 ? Dir.E : null;
  const ay = Math.abs(dy), ax = Math.abs(dx);
  if (ax > ay) return [m, n].filter((x): x is Direction => x !== null);
  return [n, m].filter((x): x is Direction => x !== null);
}

// --- Chip move choice ---
function chooseChipMove(state: GameState, input: Direction | null, discard: boolean): void {
  const chip = state.chip;
  chip.tdir = null;
  if (!(state.currentTime & 3)) chip.state &= ~CS_HASMOVED;
  if (chip.state & CS_HASMOVED) return;
  let dir = input;
  if (discard || ((chip.state & CS_SLIDE) && dir === chip.dir)) return;
  chip.tdir = dir;
}

// --- per-tick housekeeping ---
function initialHousekeeping(state: GameState): void {
  if (!(state.currentTime & 3)) {
    for (const m of state.mobs) {
      if (m.state & CS_TURNING) m.state &= ~(CS_TURNING | CS_HASMOVED);
    }
    state.chipWait++;
    if (state.chipWait > 3) { state.chipWait = 3; state.chip.dir = Dir.S; }
  }
}

function recomputeTraps(state: GameState): void {
  state.openTraps.clear();
  for (const [button, traps] of state.trapLinks) {
    const pressed = state.chip.pos === button || mobAt(state, button) !== null;
    if (pressed) for (const t of traps) state.openTraps.add(t);
  }
}

// --- the ruleset ---
export const msRuleset: Ruleset = {
  name: 'ms',
  turnsPerSecond: 5,
  ticksPerSecond: 20,

  stepTurn(state: GameState, input: MoveInput): void {
    // One logic turn = 4 ticks; used by tests/headless that think in turns.
    for (let i = 0; i < 4; i++) this.advanceTick(state, i === 0 ? input : { dir: null });
  },

  advanceTick(state: GameState, input: MoveInput): void {
    if (state.status !== 'playing') return;

    initialHousekeeping(state);
    recomputeTraps(state);

    // creatures move on even ticks
    if (state.currentTime && !(state.currentTime & 1)) {
      for (const m of state.mobs) {
        if (m.dead || m.kind === 'block' || (m.state & CS_CLONING)) continue;
        if (m.state & (CS_SLIP | CS_SLIDE)) { m.tdir = null; continue; }
        chooseCreatureMove(state, m);
        if (m.tdir !== null) advanceCreature(state, m, m.tdir);
        if (state.status !== 'playing') return;
      }
    }

    if (state.currentTime && !(state.currentTime & 1)) {
      floorMovements(state);
      if (state.status !== 'playing') return;
    }
    updateSlipList(state);

    // timer
    if (state.timeLeft >= 0) {
      const limitTicks = state.level.timeLimit * 20;
      if (state.currentTime >= limitTicks) { state.status = 'lost'; state.deathCause = 'Ooops! Out of time!'; snd(state, SND.DIE); return; }
      state.timeLeft = Math.max(0, state.level.timeLimit - Math.floor(state.currentTime / 20));
    }

    // Chip moves every tick (cadence-gated internally)
    const chip = state.chip;
    chooseChipMove(state, input.dir, (chip.state & CS_SLIP) !== 0);
    if (chip.tdir !== null) {
      advanceCreature(state, chip, chip.tdir);
      chip.state |= CS_HASMOVED;
      if (state.status !== 'playing') return;
    }
    updateSlipList(state);

    // createclones: freshly cloned creatures become eligible to move next tick.
    for (const m of state.mobs) m.state &= ~CS_CLONING;

    state.currentTime++;

    if (state.mobs.length > 1024) state.mobs = state.mobs.filter((m) => !m.dead);
  },
};
