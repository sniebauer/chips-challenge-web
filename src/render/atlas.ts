// Maps tile codes to cells in the 13x16 (32px) sprite atlas extracted from
// CHIPS.EXE. Codes 0x00-0x6F lay out column-major: index = col*16 + row, so
// col = code >> 4, row = code & 0x0F. The transparent overlay sprites used to
// draw creatures/Chip on top of terrain live 3 columns (0x30 codes) further on.

import tilesUrl from '../../assets/tiles.png';

export const TILE_PX = 32;
export const ATLAS_COLS = 13;

export interface Atlas {
  image: HTMLImageElement;
}

export async function loadAtlas(): Promise<Atlas> {
  const image = new Image();
  image.src = tilesUrl;
  await image.decode();
  return { image };
}

/** Source x/y in the atlas for an opaque tile drawn directly (terrain, blocks). */
export function srcOf(code: number): [number, number] {
  const col = (code >> 4) & 0xf;
  const row = code & 0xf;
  return [col * TILE_PX, row * TILE_PX];
}

/** Source x/y for the transparent overlay sprite of a creature/Chip code (0x40-0x6F). */
export function overlaySrcOf(code: number): [number, number] {
  return srcOf(code + 0x30);
}
