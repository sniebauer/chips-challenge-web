// Maps tile codes to cells in the 13x16 (32px) sprite atlas extracted from
// CHIPS.EXE. Codes 0x00-0x6F lay out column-major: index = col*16 + row, so
// col = code >> 4, row = code & 0x0F. The transparent overlay sprites used to
// draw creatures/Chip on top of terrain live 3 columns (0x30 codes) further on.

import tilesUrl from '../../assets/tiles.png';
import infowndUrl from '../../assets/chrome/infownd.png';
import backgroundUrl from '../../assets/chrome/background.png';
import digitsUrl from '../../assets/chrome/digits.png';

export const TILE_PX = 32;
export const ATLAS_COLS = 13;

export interface Atlas {
  image: HTMLImageElement;
}

/** Original window-chrome bitmaps extracted from CHIPS.EXE. */
export interface Chrome {
  infownd: HTMLImageElement; // 154x300 info panel
  background: HTMLImageElement; // 237x196 green circuit board (tiled)
  digits: HTMLImageElement; // 17x552 LCD digit font strip
}

async function img(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

export async function loadAtlas(): Promise<Atlas> {
  return { image: await img(tilesUrl) };
}

export async function loadChrome(): Promise<Chrome> {
  const [infownd, background, digits] = await Promise.all([
    img(infowndUrl),
    img(backgroundUrl),
    img(digitsUrl),
  ]);
  return { infownd, background, digits };
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
