// Canvas renderer drawing the whole original Windows 3.1 window: title bar, menu
// bar, green circuit-board client, the beveled 9x9 viewport, and the INFOWND info
// panel (LCD digit displays + inventory grid). Everything is drawn at native
// resolution and scaled with nearest-neighbor for crisp pixels.

import { type GameState, MAP_W, MAP_H, tx, ty } from '../engine/state';
import { TILE } from '../engine/tiles';
import { type Atlas, type Chrome, srcOf, overlaySrcOf, TILE_PX } from './atlas';
import type { Ui } from '../ui/desktop';

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
const C_GRAY_TEXT = '#808080';
const MENU_FONT = '11px Tahoma, "MS Sans Serif", sans-serif';

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

  draw(state: GameState, ui: Ui): void {
    this.drawWindowFrame(state, ui);
    this.drawClient(state);
    if (ui.isPausedView()) this.drawPausedViewport();
    else this.drawViewport(state, ui);
    this.drawPanel(state);
    if (ui.openMenu !== null) this.drawDropdown(ui);
    if (ui.dialog) this.drawDialog(ui);
  }

  // --- window chrome ---

  private drawWindowFrame(state: GameState, ui: Ui): void {
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
    ctx.font = MENU_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const menus = ui.menus();
    ui.barRects = [];
    let mx = BORDER + 6;
    menus.forEach((m, i) => {
      const w = ctx.measureText(m.label).width + 12;
      const r = { x: mx, y: my, w, h: MENU_H };
      ui.barRects.push(r);
      if (ui.openMenu === i) {
        ctx.fillStyle = C_TITLE;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#fff';
      } else {
        ctx.fillStyle = C_DARK;
      }
      this.menuText(m.label, mx + 6, my + MENU_H / 2 + 1, m.accel);
      mx += w;
    });
  }

  /** Draw a menu label with the accelerator character underlined. */
  private menuText(label: string, x: number, y: number, accel: number | undefined): void {
    const ctx = this.ctx;
    ctx.fillText(label, x, y);
    if (accel !== undefined && accel >= 0 && accel < label.length) {
      const pre = ctx.measureText(label.slice(0, accel)).width;
      const cw = ctx.measureText(label[accel]!).width;
      ctx.fillRect(x + pre, y + 6, cw, 1);
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

  private drawViewport(state: GameState, ui: Ui): void {
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

    // Level-start popup: "LESSON 1 / Password: BDHP" (yellow on black).
    if (ui.levelStart) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 20px Tahoma, sans-serif';
      const w1 = ctx.measureText(ui.levelStart.title).width;
      ctx.font = '13px Tahoma, sans-serif';
      const w2 = ctx.measureText(`Password: ${ui.levelStart.password}`).width;
      const bw = Math.max(w1, w2) + 28;
      const bx = VPX + VIEW_PX / 2 - bw / 2, by2 = VPY + VIEW_PX - 78, bh = 56;
      ctx.fillStyle = '#000';
      ctx.fillRect(bx, by2, bw, bh);
      ctx.fillStyle = '#ffe000';
      ctx.font = 'bold 20px Tahoma, sans-serif';
      ctx.fillText(ui.levelStart.title, VPX + VIEW_PX / 2, by2 + 19);
      ctx.font = '13px Tahoma, sans-serif';
      ctx.fillText(`Password: ${ui.levelStart.password}`, VPX + VIEW_PX / 2, by2 + 39);
      ctx.textAlign = 'left';
    }
  }

  private drawPausedViewport(): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_FACE;
    ctx.fillRect(FRAME_X, FRAME_Y, VIEW_PX + 2 * FRAME, VIEW_PX + 2 * FRAME);
    bevel(ctx, FRAME_X, FRAME_Y, VIEW_PX + 2 * FRAME, VIEW_PX + 2 * FRAME, false, 2);
    bevel(ctx, VPX - 2, VPY - 2, VIEW_PX + 4, VIEW_PX + 4, false, 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(VPX, VPY, VIEW_PX, VIEW_PX);
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 36px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', VPX + VIEW_PX / 2, VPY + VIEW_PX / 2);
    ctx.textAlign = 'left';
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

  // --- menus & dialogs ---

  private drawDropdown(ui: Ui): void {
    const ctx = this.ctx;
    const mi = ui.openMenu!;
    const bar = ui.barRects[mi]!;
    const items = ui.menus()[mi]!.items;
    ctx.font = MENU_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // width = widest label (+ check gutter) + widest shortcut + padding
    let labelW = 0, shortW = 0;
    for (const it of items) {
      if (it.separator) continue;
      labelW = Math.max(labelW, ctx.measureText(it.label!).width);
      if (it.shortcut) shortW = Math.max(shortW, ctx.measureText(it.shortcut).width);
    }
    const padL = 20, gap = 24, padR = 12;
    const w = padL + labelW + gap + shortW + padR;
    const rowH = 16;
    let y = bar.y + bar.h;
    const x = bar.x;
    let h = 0;
    for (const it of items) h += it.separator ? 6 : rowH;

    // shadow + box
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 2, w, h + 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C_DARK;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ui.dropItemRects = [];
    items.forEach((it, i) => {
      if (it.separator) {
        ui.dropItemRects.push({ x, y, w, h: 6 });
        ctx.strokeStyle = C_SHADOW;
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3.5); ctx.lineTo(x + w - 3, y + 3.5); ctx.stroke();
        ctx.strokeStyle = C_LIGHT;
        ctx.beginPath(); ctx.moveTo(x + 3, y + 4.5); ctx.lineTo(x + w - 3, y + 4.5); ctx.stroke();
        y += 6;
        return;
      }
      const r = { x, y, w, h: rowH };
      ui.dropItemRects.push(r);
      const disabled = it.enabled === false;
      const sel = ui.hoverItem === i && !disabled;
      if (sel) { ctx.fillStyle = C_TITLE; ctx.fillRect(x, y, w, rowH); }
      ctx.fillStyle = disabled ? C_GRAY_TEXT : sel ? '#fff' : C_DARK;
      if (it.checked) ctx.fillText('✓', x + 6, y + rowH / 2 + 1);
      this.menuText(it.label!, x + padL, y + rowH / 2 + 1, it.accel);
      if (it.shortcut) {
        ctx.textAlign = 'right';
        ctx.fillText(it.shortcut, x + w - padR, y + rowH / 2 + 1);
        ctx.textAlign = 'left';
      }
      y += rowH;
    });
  }

  private drawDialog(ui: Ui): void {
    const ctx = this.ctx;
    const d = ui.dialog!;
    const isGoto = d.kind === 'goto';
    const w = isGoto ? 250 : 240;
    const h = isGoto ? 150 : 64 + (d.lines?.length ?? 1) * 15 + 16;
    const x = Math.round((LOGICAL_W - w) / 2);
    const y = Math.round((LOGICAL_H - h) / 2) - 10;

    // window: raised face + blue title bar
    ctx.fillStyle = C_FACE; ctx.fillRect(x, y, w, h);
    bevel(ctx, x, y, w, h, true, 2);
    ctx.fillStyle = C_TITLE; ctx.fillRect(x + 3, y + 3, w - 6, 16);
    drawBevelButton(ctx, x + 4, y + 4, 14, 14);
    ctx.fillStyle = C_DARK; ctx.fillRect(x + 7, y + 10, 8, 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Tahoma, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.title, x + w / 2, y + 11);

    ctx.textAlign = 'left';
    ctx.fillStyle = C_DARK;
    ctx.font = '12px Tahoma, sans-serif';
    ui.dialogButtons = [];
    ui.dialogFieldRects = [];

    if (isGoto) {
      ctx.fillText('Enter a level number and password,', x + 14, y + 32);
      ctx.fillText('or just a password.', x + 14, y + 46);
      this.dialogField(ui, 'Level number:', d.levelField ?? '', d.focus === 'level', x + 14, y + 64, x + w - 90);
      this.dialogField(ui, 'Password:', d.passwordField ?? '', d.focus === 'password', x + 14, y + 86, x + w - 90);
      this.dialogButton(ui, 'OK', x + w / 2 - 78, y + h - 26, () => ui.confirmDialog());
      this.dialogButton(ui, 'Cancel', x + w / 2 + 6, y + h - 26, () => { ui.dialog = null; });
    } else {
      const lines = d.lines ?? [];
      lines.forEach((ln, i) => { ctx.textAlign = 'center'; ctx.fillText(ln, x + w / 2, y + 38 + i * 15); });
      ctx.textAlign = 'left';
      this.dialogButton(ui, 'OK', x + w / 2 - 36, y + h - 26, () => ui.confirmDialog());
    }
  }

  private dialogField(ui: Ui, label: string, value: string, focused: boolean, x: number, y: number, fieldX: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_DARK;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '12px Tahoma, sans-serif';
    ctx.fillText(label, x, y + 7);
    const fw = 72, fh = 16;
    ctx.fillStyle = '#fff'; ctx.fillRect(fieldX, y, fw, fh);
    bevel(ctx, fieldX, y, fw, fh, false, 1);
    ctx.fillStyle = C_DARK;
    ctx.fillText(value + (focused ? '|' : ''), fieldX + 4, y + 8);
    ui.dialogFieldRects.push({ which: label.startsWith('Level') ? 'level' : 'password', rect: { x: fieldX, y, w: fw, h: fh } });
  }

  private dialogButton(ui: Ui, label: string, x: number, y: number, onClick: () => void): void {
    const ctx = this.ctx;
    const w = 72, h = 20;
    ctx.fillStyle = C_FACE; ctx.fillRect(x, y, w, h);
    bevel(ctx, x, y, w, h, true, 2);
    ctx.fillStyle = C_DARK;
    ctx.font = 'bold 11px Tahoma, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ui.dialogButtons.push({ label, rect: { x, y, w, h }, onClick });
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
