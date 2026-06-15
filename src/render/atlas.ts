// Maps tile codes to cells in the 13x16 (32px) sprite atlas extracted from
// CHIPS.EXE. Codes 0x00-0x6F lay out column-major: index = col*16 + row, so
// col = code >> 4, row = code & 0x0F. The transparent overlay sprites used to
// draw creatures/Chip on top of terrain live 3 columns (0x30 codes) further on.

import tilesUrl from '../../assets/tiles.png';
import infowndUrl from '../../assets/chrome/infownd.png';
import backgroundUrl from '../../assets/chrome/background.png';
import digitsUrl from '../../assets/chrome/digits.png';
import fontUrl from '../../assets/fonts/font.png';
import pausedUrl from '../../assets/fonts/paused.png';
import passwordUrl from '../../assets/fonts/password.png';
import fontMetrics from '../../assets/fonts/font.json';

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

// --- authentic in-game bitmap font (ripped from the original UI sheet) ---

export interface GlyphBox { x: number; y: number; w: number; h: number; }
export interface FontMetrics {
  lineHeight: number;
  cellHeight: number;
  baseline: number;
  space: number; // advance width of a space
  gap: number; // inter-glyph advance padding
  glyphs: Record<string, GlyphBox>;
}

export interface BitmapFont {
  metrics: FontMetrics;
  /** The white master glyph atlas, pre-tinted per color (keyed by css color). */
  tinted: Map<string, HTMLCanvasElement>;
  /** Authentic "Password:" word sprite, pre-tinted yellow. */
  passwordYellow: HTMLCanvasElement;
  /** Authentic "PAUSED" word sprite, pre-tinted red. */
  pausedRed: HTMLCanvasElement;
}

/** The colors the renderer draws bitmap text in (pre-baked to avoid per-frame tinting). */
export const FONT_WHITE = '#ffffff';
export const FONT_YELLOW = '#ffe000';
export const FONT_RED = '#ff0000';

/** Tint a white/alpha mask image into an offscreen canvas of the given color. */
function tintMask(src: CanvasImageSource, w: number, h: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c;
}

export async function loadFont(): Promise<BitmapFont> {
  const [font, paused, password] = await Promise.all([img(fontUrl), img(pausedUrl), img(passwordUrl)]);
  const metrics = fontMetrics as unknown as FontMetrics;
  const tinted = new Map<string, HTMLCanvasElement>();
  for (const color of [FONT_WHITE, FONT_YELLOW, FONT_RED]) {
    tinted.set(color, tintMask(font, font.width, font.height, color));
  }
  return {
    metrics,
    tinted,
    passwordYellow: tintMask(password, password.width, password.height, FONT_YELLOW),
    pausedRed: tintMask(paused, paused.width, paused.height, FONT_RED),
  };
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
