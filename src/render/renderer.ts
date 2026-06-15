// Canvas renderer drawing the whole original Windows 3.1 window: title bar, menu
// bar, green circuit-board client, the beveled 9x9 viewport, and the INFOWND info
// panel (LCD digit displays + inventory grid). Everything is drawn at native
// resolution and scaled with nearest-neighbor for crisp pixels.

import { type GameState, MAP_W, MAP_H, tx, ty } from '../engine/state';
import { TILE } from '../engine/tiles';
import { type Atlas, type Chrome, srcOf, overlaySrcOf, TILE_PX } from './atlas';

// --- layout (logical pixels) ---
export const VIEW = 9;
const VIEW_PX = VIEW * TILE_PX; // 288
const BORDER = 3;
const TITLE_H = 18;
const MENU_H = 18;
const CLIENT_X = BORDER;
const CLIENT_Y = BORDER + TITLE_H + MENU_H; // 39
const MARGIN = 26;
const FRAME = 6; // viewport bevel thickness
const GAP = 13;
const PANEL_W = 154;
const CLIENT_W = MARGIN + (VIEW_PX + 2 * FRAME) + GAP + PANEL_W + 19; // 512
const CLIENT_H = MARGIN + (VIEW_PX + 2 * FRAME) + MARGIN; // 352
export const LOGICAL_W = CLIENT_W + 2 * BORDER; // 518
export const LOGICAL_H = CLIENT_Y + CLIENT_H + BORDER; // 394

const FRAME_X = CLIENT_X + MARGIN;
const FRAME_Y = CLIENT_Y + MARGIN;
const VPX = FRAME_X + FRAME;
const VPY = FRAME_Y + FRAME;
const PANEL_X = FRAME_X + VIEW_PX + 2 * FRAME + GAP;
const PANEL_Y = CLIENT_Y + MARGIN;

// Win3.1 bevel palette
const C_FACE = '#c0c0c0';
const C_LIGHT = '#ffffff';
const C_SHADOW = '#808080';
const C_DARK = '#000000';
const C_TITLE = '#000080';

// LCD digit strip metrics (digits.png is 17x552). 24 cells, 23px pitch, 21px tall;
// cells 0-11 = yellow set, 12-23 = green set. Within a set: offset 0=dash, 1=dim ghost,
// 2='9', 3='8', ... 11='0'. So digit d -> set offset (11 - d); leading blanks use the ghost.
const D_W = 17;
const D_H = 21;
const D_PITCH = 23;
const D_TOP = 1;
const GREEN_BASE = 12;
const YELLOW_BASE = 0;
const GHOST_OFFSET = 1;

// LCD windows inside INFOWND (panel-relative): [x, y]
const LCD = { level: [45, 34], time: [45, 96], chips: [45, 186] } as const;
const LCD_W = 55;
const LCD_H = 29;

const KEY_CODES = [TILE.KEY_BLUE, TILE.KEY_RED, TILE.KEY_GREEN, TILE.KEY_YELLOW];
const BOOT_CODES = [TILE.BOOTS_WATER, TILE.BOOTS_FIRE, TILE.BOOTS_ICE, TILE.BOOTS_FORCE];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bgPattern: CanvasPattern | null = null;

  constructor(private atlas: Atlas, private chrome: Chrome) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LOGICAL_W;
    this.canvas.height = LOGICAL_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.bgPattern = ctx.createPattern(chrome.background, 'repeat');
  }

  fit(container: HTMLElement): void {
    const scale = Math.max(
      1,
      Math.floor(Math.min(container.clientWidth / LOGICAL_W, container.clientHeight / LOGICAL_H)),
    );
    this.canvas.style.width = `${LOGICAL_W * scale}px`;
    this.canvas.style.height = `${LOGICAL_H * scale}px`;
  }

  draw(state: GameState): void {
    this.drawWindowFrame(state);
    this.drawClient(state);
    this.drawViewport(state);
    this.drawPanel(state);
  }

  // --- window chrome ---

  private drawWindowFrame(state: GameState): void {
    const ctx = this.ctx;
    // Outer raised bevel + face.
    ctx.fillStyle = C_FACE;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    bevel(ctx, 0, 0, LOGICAL_W, LOGICAL_H, true, 2);

    // Title bar.
    ctx.fillStyle = C_TITLE;
    ctx.fillRect(BORDER, BORDER, LOGICAL_W - 2 * BORDER, TITLE_H);
    // control-menu box (left)
    drawBevelButton(ctx, BORDER + 1, BORDER + 1, TITLE_H - 2, TITLE_H - 2);
    ctx.fillStyle = C_DARK;
    ctx.fillRect(BORDER + 4, BORDER + TITLE_H / 2 - 1, TITLE_H - 8, 3);
    // min / max buttons (right)
    const by = BORDER + 1, bs = TITLE_H - 2;
    const maxX = LOGICAL_W - BORDER - bs - 1;
    const minX = maxX - bs - 1;
    drawBevelButton(ctx, minX, by, bs, bs);
    drawBevelButton(ctx, maxX, by, bs, bs);
    ctx.fillStyle = C_DARK;
    ctx.fillRect(minX + 4, by + bs - 6, bs - 8, 2); // down arrow bar
    ctx.strokeStyle = C_DARK;
    ctx.strokeRect(maxX + 3.5, by + 3.5, bs - 7, bs - 8); // up box
    ctx.fillRect(maxX + 3, by + 3, bs - 6, 2);
    // title text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Tahoma, "MS Sans Serif", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`Chip's Challenge: ${state.level.title}`, BORDER + TITLE_H + 4, BORDER + TITLE_H / 2 + 1);

    // Menu bar.
    const my = BORDER + TITLE_H;
    ctx.fillStyle = C_FACE;
    ctx.fillRect(BORDER, my, LOGICAL_W - 2 * BORDER, MENU_H);
    ctx.fillStyle = C_DARK;
    ctx.font = '11px Tahoma, "MS Sans Serif", sans-serif';
    let mx = BORDER + 8;
    for (const item of ['Game', 'Options', 'Level', 'Help']) {
      ctx.fillText(item, mx, my + MENU_H / 2 + 1);
      mx += ctx.measureText(item).width + 16;
    }
  }

  private drawClient(state: GameState): void {
    const ctx = this.ctx;
    // Green circuit board.
    if (this.bgPattern) {
      ctx.save();
      ctx.translate(CLIENT_X, CLIENT_Y);
      ctx.fillStyle = this.bgPattern;
      ctx.fillRect(0, 0, CLIENT_W, CLIENT_H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#008000';
      ctx.fillRect(CLIENT_X, CLIENT_Y, CLIENT_W, CLIENT_H);
    }
    void state;
  }

  private drawViewport(state: GameState): void {
    const ctx = this.ctx;
    // Sunken gray frame around the viewport.
    ctx.fillStyle = C_FACE;
    ctx.fillRect(FRAME_X, FRAME_Y, VIEW_PX + 2 * FRAME, VIEW_PX + 2 * FRAME);
    bevel(ctx, FRAME_X, FRAME_Y, VIEW_PX + 2 * FRAME, VIEW_PX + 2 * FRAME, false, 2);
    bevel(ctx, VPX - 2, VPY - 2, VIEW_PX + 4, VIEW_PX + 4, false, 2);

    const camX = clamp(tx(state.chip.pos) - (VIEW >> 1), 0, MAP_W - VIEW);
    const camY = clamp(ty(state.chip.pos) - (VIEW >> 1), 0, MAP_H - VIEW);

    for (let row = 0; row < VIEW; row++) {
      for (let col = 0; col < VIEW; col++) {
        const i = (camY + row) * MAP_W + (camX + col);
        this.blit(state.terrain[i]!, VPX + col * TILE_PX, VPY + row * TILE_PX);
      }
    }
    for (const m of state.mobs) {
      if (m.dead) continue;
      const mx = tx(m.pos), my = ty(m.pos);
      if (mx < camX || mx >= camX + VIEW || my < camY || my >= camY + VIEW) continue;
      const dx = VPX + (mx - camX) * TILE_PX, dy = VPY + (my - camY) * TILE_PX;
      if (m.kind === 'block') this.blit(TILE.BLOCK, dx, dy);
      else this.blitOverlay(m.id + m.dir, dx, dy);
    }
    {
      const cx = VPX + (tx(state.chip.pos) - camX) * TILE_PX;
      const cy = VPY + (ty(state.chip.pos) - camY) * TILE_PX;
      const swimming = state.terrain[state.chip.pos] === TILE.WATER;
      const code = (swimming ? TILE.CHIP_SWIM_N : TILE.CHIP_N) + state.chip.dir;
      if (swimming) this.blit(code, cx, cy);
      else this.blitOverlay(code, cx, cy);
    }

    if (state.terrain[state.chip.pos] === TILE.HINT && state.level.hint) {
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(VPX, VPY + VIEW_PX - 44, VIEW_PX, 44);
      ctx.fillStyle = '#ffe070';
      ctx.font = '11px Tahoma, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      wrapText(ctx, state.level.hint, VPX + 6, VPY + VIEW_PX - 40, VIEW_PX - 12, 13);
    }

    if (state.status === 'won') this.banner('LEVEL COMPLETE');
    else if (state.status === 'lost') this.banner(state.deathCause || 'OOPS!');
  }

  // --- info panel ---

  private drawPanel(state: GameState): void {
    const ctx = this.ctx;
    ctx.drawImage(this.chrome.infownd, PANEL_X, PANEL_Y);

    // LCD displays (level untimed -> ghosts on TIME).
    const lowTime = state.timeLeft >= 0 && state.timeLeft <= 15;
    this.drawLcd(state.level.number, LCD.level, false);
    this.drawLcd(state.timeLeft, LCD.time, lowTime);
    this.drawLcd(state.chipsLeft, LCD.chips, false);

    // Inventory grid (4 cols x 2 rows) in the panel's lower gray area.
    const gx = PANEL_X + 17, gy = PANEL_Y + 222, cw = 30, ch = 29;
    for (let c = 0; c < 4; c++) {
      this.invSlot(gx + c * cw, gy, cw - 2, ch - 1, state.keys[c]! > 0 ? KEY_CODES[c]! : -1);
      this.invSlot(gx + c * cw, gy + ch, cw - 2, ch - 1, state.boots[c] ? BOOT_CODES[c]! : -1);
    }
  }

  private invSlot(x: number, y: number, w: number, h: number, code: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_FACE;
    ctx.fillRect(x, y, w, h);
    bevel(ctx, x, y, w, h, false, 1);
    if (code >= 0) {
      const [sx, sy] = srcOf(code);
      const pad = 2;
      ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, x + pad, y + pad, w - 2 * pad, h - 2 * pad);
    }
  }

  /** Draw a 3-digit LCD value; leading unused positions show the dim ghost. */
  private drawLcd(value: number, [bx, by]: readonly [number, number], yellow: boolean): void {
    const x0 = PANEL_X + bx + (LCD_W - 3 * D_W) / 2;
    const y0 = PANEL_Y + by + (LCD_H - D_H) / 2;
    const base = yellow ? YELLOW_BASE : GREEN_BASE;
    // Right-aligned 3-digit string; spaces become the dim ghost glyph.
    const str = value < 0 ? '   ' : String(Math.min(999, Math.max(0, Math.floor(value)))).padStart(3, ' ');
    for (let i = 0; i < 3; i++) {
      const ch = str[i]!;
      const off = ch === ' ' ? GHOST_OFFSET : 11 - Number(ch);
      const sy = D_TOP + (base + off) * D_PITCH;
      this.ctx.drawImage(this.chrome.digits, 0, sy, D_W, D_H, x0 + i * D_W, y0, D_W, D_H);
    }
  }

  // --- primitives ---

  private blit(code: number, dx: number, dy: number): void {
    const [sx, sy] = srcOf(code);
    this.ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
  }
  private blitOverlay(code: number, dx: number, dy: number): void {
    const [sx, sy] = overlaySrcOf(code);
    this.ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
  }

  private banner(text: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(VPX, VPY + VIEW_PX / 2 - 20, VIEW_PX, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, VPX + VIEW_PX / 2, VPY + VIEW_PX / 2);
    ctx.textAlign = 'left';
  }
}

// --- helpers ---

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Win3.1 3D bevel: raised = light top/left, dark bottom/right; sunken = inverse. */
function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, raised: boolean, t: number): void {
  const tl = raised ? C_LIGHT : C_SHADOW;
  const br = raised ? C_SHADOW : C_LIGHT;
  ctx.fillStyle = tl;
  ctx.fillRect(x, y, w, t); // top
  ctx.fillRect(x, y, t, h); // left
  ctx.fillStyle = br;
  ctx.fillRect(x, y + h - t, w, t); // bottom
  ctx.fillRect(x + w - t, y, t, h); // right
}

function drawBevelButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = C_FACE;
  ctx.fillRect(x, y, w, h);
  bevel(ctx, x, y, w, h, true, 1);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  const words = text.split(/\s+/);
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
