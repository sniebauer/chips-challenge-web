// CC1 / MS tile codes (0x00-0x6F). Each code is also its cell index in the
// 13x16 sprite atlas (column-major: col = code >> 4, row = code & 0x0F).
// Direction convention throughout the engine: N=0, W=1, S=2, E=3 — matching the
// way creature/Chip codes are laid out (base + dir).

export const Dir = { N: 0, W: 1, S: 2, E: 3 } as const;
export type Direction = (typeof Dir)[keyof typeof Dir];

// Movement deltas indexed by Direction.
export const DX = [0, -1, 0, 1] as const; // N, W, S, E
export const DY = [-1, 0, 1, 0] as const;

export function back(d: Direction): Direction {
  return ((d + 2) & 3) as Direction;
}
export function left(d: Direction): Direction {
  return ((d + 1) & 3) as Direction; // N->W->S->E (counter-clockwise in this ordering)
}
export function right(d: Direction): Direction {
  return ((d + 3) & 3) as Direction;
}

export const TILE = {
  FLOOR: 0x00,
  WALL: 0x01,
  CHIP: 0x02,
  WATER: 0x03,
  FIRE: 0x04,
  INVISIBLE_WALL: 0x05, // permanent, never revealed
  THIN_WALL_N: 0x06,
  THIN_WALL_W: 0x07,
  THIN_WALL_S: 0x08,
  THIN_WALL_E: 0x09,
  BLOCK: 0x0a, // movable block (static, on its own)
  DIRT: 0x0b,
  ICE: 0x0c,
  FORCE_S: 0x0d,
  BLOCK_N: 0x0e, // directional block (used on/from clone machines)
  BLOCK_W: 0x0f,
  BLOCK_S: 0x10,
  BLOCK_E: 0x11,
  FORCE_N: 0x12,
  FORCE_E: 0x13,
  FORCE_W: 0x14,
  EXIT: 0x15,
  DOOR_BLUE: 0x16,
  DOOR_RED: 0x17,
  DOOR_GREEN: 0x18,
  DOOR_YELLOW: 0x19,
  ICE_SE: 0x1a, // ice corner; name = the two open sides
  ICE_SW: 0x1b,
  ICE_NW: 0x1c,
  ICE_NE: 0x1d,
  BLUEWALL_FAKE: 0x1e, // disappears when pushed
  BLUEWALL_REAL: 0x1f,
  OVERLAY_BUFFER: 0x20, // not used in map data
  THIEF: 0x21,
  SOCKET: 0x22,
  BUTTON_GREEN: 0x23, // toggles TOGGLE walls
  BUTTON_RED: 0x24, // clone
  TOGGLE_CLOSED: 0x25,
  TOGGLE_OPEN: 0x26,
  BUTTON_BROWN: 0x27, // springs traps
  BUTTON_BLUE: 0x28, // reverses tanks
  TELEPORT: 0x29,
  BOMB: 0x2a,
  TRAP: 0x2b,
  HIDDEN_WALL_TEMP: 0x2c, // revealed (becomes wall) when bumped
  GRAVEL: 0x2d,
  POPUP_WALL: 0x2e, // becomes wall after Chip steps off
  HINT: 0x2f,
  THIN_WALL_SE: 0x30,
  CLONE_MACHINE: 0x31,
  FORCE_RANDOM: 0x32,
  CHIP_DROWNED: 0x33, // death animation tiles
  CHIP_BURNED_FIRE: 0x34,
  CHIP_BURNED: 0x35,
  UNUSED_36: 0x36,
  UNUSED_37: 0x37,
  UNUSED_38: 0x38,
  CHIP_EXIT: 0x39, // exit animation overlay
  EXIT_EXTRA1: 0x3a,
  EXIT_EXTRA2: 0x3b,
  CHIP_SWIM_N: 0x3c,
  CHIP_SWIM_W: 0x3d,
  CHIP_SWIM_S: 0x3e,
  CHIP_SWIM_E: 0x3f,
  // Creatures: base + Direction (N,W,S,E)
  BUG_N: 0x40,
  FIREBALL_N: 0x44,
  BALL_N: 0x48,
  TANK_N: 0x4c,
  GLIDER_N: 0x50,
  TEETH_N: 0x54,
  WALKER_N: 0x58,
  BLOB_N: 0x5c,
  PARAMECIUM_N: 0x60,
  // Keys / boots
  KEY_BLUE: 0x64,
  KEY_RED: 0x65,
  KEY_GREEN: 0x66,
  KEY_YELLOW: 0x67,
  BOOTS_WATER: 0x68, // flippers
  BOOTS_FIRE: 0x69,
  BOOTS_ICE: 0x6a, // ice skates
  BOOTS_FORCE: 0x6b, // suction boots
  // Chip
  CHIP_N: 0x6c,
  CHIP_W: 0x6d,
  CHIP_S: 0x6e,
  CHIP_E: 0x6f,
} as const;

export type TileCode = number;

// --- Classification helpers (shared by engine + renderer) ---

export function isCreatureCode(t: TileCode): boolean {
  return t >= TILE.BUG_N && t <= TILE.PARAMECIUM_N + 3;
}
/** Returns the creature's "species base" code (N variant), or -1 if not a creature. */
export function creatureBase(t: TileCode): TileCode {
  return isCreatureCode(t) ? t & ~3 : -1;
}
export function creatureDir(t: TileCode): Direction {
  return (t & 3) as Direction;
}
export function withDir(base: TileCode, d: Direction): TileCode {
  return base + d;
}

export function isChipCode(t: TileCode): boolean {
  return t >= TILE.CHIP_N && t <= TILE.CHIP_E;
}
export function isBlockCode(t: TileCode): boolean {
  return t === TILE.BLOCK || (t >= TILE.BLOCK_N && t <= TILE.BLOCK_E);
}
export function isKeyCode(t: TileCode): boolean {
  return t >= TILE.KEY_BLUE && t <= TILE.KEY_YELLOW;
}
export function isBootCode(t: TileCode): boolean {
  return t >= TILE.BOOTS_WATER && t <= TILE.BOOTS_FORCE;
}
export function isIceCorner(t: TileCode): boolean {
  return t >= TILE.ICE_SE && t <= TILE.ICE_NE;
}
export function isForceFloor(t: TileCode): boolean {
  return t === TILE.FORCE_S || (t >= TILE.FORCE_N && t <= TILE.FORCE_W) || t === TILE.FORCE_RANDOM;
}

/** Human-readable names, indexed by code, for debugging / hint UI. */
export const TILE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(TILE).map(([k, v]) => [v, k]),
);
