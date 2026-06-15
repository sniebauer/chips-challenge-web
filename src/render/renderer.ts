// Canvas renderer drawing the whole original Windows 3.1 window: title bar, menu
// bar, green circuit-board client, the beveled 9x9 viewport, and the INFOWND info
// panel (LCD digit displays + inventory grid). Everything is drawn at native
// resolution and scaled with nearest-neighbor for crisp pixels.

import { type GameState, MAP_W, MAP_H, tx, ty } from '../engine/state';
import { TILE } from '../engine/tiles';
import { type Atlas, type Chrome, type BitmapFont, FONT_WHITE, FONT_YELLOW, srcOf, overlaySrcOf, TILE_PX } from './atlas';
import type { Ui } from '../ui/desktop';

// --- layout (logical pixels) ---
export const VIEW = 9;
const VIEW_PX = VIEW * TILE_PX; // 288
const BORDER = 3;
const MENU_H = 18;
const CLIENT_X = BORDER;
// The OS title bar is owned by the host shell (the game is embedded in a Win95
// window); the menu bar sits directly under the thin outer border.
const CLIENT_Y = BORDER + MENU_H; // 21
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
const C_HILITE_TEXT = '#ffffff'; // selected menu text (Win95)
const MENU_FONT = '12px W95FA, Tahoma, "MS Sans Serif", sans-serif';

// Win95 dropdown metrics.
const DROP_ROW_H = 18;
const DROP_SEP_H = 7;
const DROP_GUTTER = 22; // left checkmark gutter
const DROP_GAP = 24; // label -> shortcut gap
const DROP_PAD_R = 16; // right padding after the shortcut column

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
  // Backing-store -> logical scale (device pixels per logical pixel). The canvas
  // is rendered at display resolution so text stays crisp at any size.
  private sx = 1;
  private sy = 1;

  constructor(private atlas: Atlas, private chrome: Chrome, private font: BitmapFont) {
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
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // Fractional scale to fill the container while preserving aspect ratio.
    const scale = Math.max(
      1,
      Math.min(container.clientWidth / LOGICAL_W, container.clientHeight / LOGICAL_H),
    );
    this.canvas.style.width = `${Math.round(LOGICAL_W * scale)}px`;
    this.canvas.style.height = `${Math.round(LOGICAL_H * scale)}px`;
    // Render the backing store at device resolution so canvas text stays crisp at
    // any size; sprites are nearest-neighbor scaled, only vector text antialiases.
    const bw = Math.max(LOGICAL_W, Math.round(LOGICAL_W * scale * dpr));
    const bh = Math.max(LOGICAL_H, Math.round(LOGICAL_H * scale * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.ctx.imageSmoothingEnabled = false; // resizing the canvas resets ctx state
    }
    this.sx = bw / LOGICAL_W;
    this.sy = bh / LOGICAL_H;
  }

  /** Map a logical-canvas pixel to a board cell index, or -1 if outside the 9x9 viewport. */
  viewportCellAt(state: GameState, lx: number, ly: number): number {
    if (lx < VPX || lx >= VPX + VIEW_PX || ly < VPY || ly >= VPY + VIEW_PX) return -1;
    const camX = clamp(tx(state.chip.pos) - (VIEW >> 1), 0, MAP_W - VIEW);
    const camY = clamp(ty(state.chip.pos) - (VIEW >> 1), 0, MAP_H - VIEW);
    const col = Math.floor((lx - VPX) / TILE_PX);
    const row = Math.floor((ly - VPY) / TILE_PX);
    return (camY + row) * MAP_W + (camX + col);
  }

  draw(state: GameState, ui: Ui): void {
    // Map logical coordinates onto the device-resolution backing store.
    this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.drawWindowFrame(ui);
    this.drawClient(state);
    if (ui.isPausedView()) this.drawPausedViewport();
    else this.drawViewport(state, ui);
    this.drawPanel(state);
    if (ui.openMenu !== null) this.drawDropdown(ui);
    if (ui.dialog) this.drawDialog(ui);
  }

  // --- window chrome ---

  private drawWindowFrame(ui: Ui): void {
    const ctx = this.ctx;
    // Outer raised bevel + face.
    ctx.fillStyle = C_FACE;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    bevel(ctx, 0, 0, LOGICAL_W, LOGICAL_H, true, 2);

    // Menu bar (directly under the outer border; the OS title bar is the host's).
    const my = BORDER;
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
        ctx.fillStyle = C_HILITE_TEXT;
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
      ctx.font = '11px W95FA, Tahoma, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      wrapText(ctx, state.level.hint, VPX + 6, VPY + VIEW_PX - 40, VIEW_PX - 12, 13);
    }

    // Level-start popup: "LESSON 1 / Password: BDHP" in the authentic bitmap font,
    // yellow on a black field with a red border (matching the original chrome).
    if (ui.levelStart) {
      const SC = 1;
      const m = this.font.metrics;
      const title = ui.levelStart.title;
      const pw = ui.levelStart.password;
      const lh = m.cellHeight * SC;
      const titleW = this.bitmapTextWidth(title, SC);
      const pwLabel = this.font.passwordYellow;
      const lineGap = 5;
      const pwLineW = pwLabel.width + lineGap + this.bitmapTextWidth(pw, SC);
      const padX = 12, padY = 9, rowGap = 6;
      const bw = Math.max(titleW, pwLineW) + padX * 2;
      const bh = lh * 2 + rowGap + padY * 2;
      const bx = Math.round(VPX + VIEW_PX / 2 - bw / 2);
      const by = VPY + VIEW_PX - bh - 12;
      // black field with a raised 3D bevel: white highlight on top/left, gray
      // shadow on bottom/right (matches the original — no red border).
      ctx.fillStyle = '#000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = C_LIGHT; // #ffffff
      ctx.fillRect(bx, by, bw, 1); // top
      ctx.fillRect(bx, by, 1, bh); // left
      ctx.fillStyle = C_SHADOW; // #808080
      ctx.fillRect(bx, by + bh - 2, bw, 2); // bottom
      ctx.fillRect(bx + bw - 2, by, 2, bh); // right
      // title (yellow), centered
      this.drawBitmapText(title, Math.round(bx + bw / 2 - titleW / 2), by + padY, FONT_YELLOW, SC);
      // password line: the "Password:" sprite + the code, centered
      const lineY = by + padY + lh + rowGap;
      const lineX = Math.round(bx + bw / 2 - pwLineW / 2);
      ctx.drawImage(pwLabel, lineX, Math.round(lineY + (lh - pwLabel.height) / 2));
      this.drawBitmapText(pw, lineX + pwLabel.width + lineGap, lineY, FONT_YELLOW, SC);
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
    // Authentic red "PAUSED" word, centered and scaled to the viewport.
    const sprite = this.font.pausedRed;
    const sc = (VIEW_PX * 0.82) / sprite.width;
    const dw = Math.round(sprite.width * sc);
    const dh = Math.round(sprite.height * sc);
    ctx.drawImage(sprite, Math.round(VPX + (VIEW_PX - dw) / 2), Math.round(VPY + (VIEW_PX - dh) / 2), dw, dh);
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

    // width = gutter + widest label + gap + widest shortcut + right pad
    let labelW = 0, shortW = 0;
    for (const it of items) {
      if (it.separator) continue;
      labelW = Math.max(labelW, ctx.measureText(it.label!).width);
      if (it.shortcut) shortW = Math.max(shortW, ctx.measureText(it.shortcut).width);
    }
    const w = DROP_GUTTER + labelW + DROP_GAP + shortW + DROP_PAD_R;
    const x = bar.x;
    let y = bar.y + bar.h;
    let h = 0;
    for (const it of items) h += it.separator ? DROP_SEP_H : DROP_ROW_H;

    // drop shadow, then a gray Win95 panel with a raised bevel (no white fill / black outline)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 2, w, h + 2);
    ctx.fillStyle = C_FACE;
    ctx.fillRect(x, y, w, h);
    bevelWin95(ctx, x, y, w, h);

    ui.dropItemRects = [];
    items.forEach((it, i) => {
      if (it.separator) {
        ui.dropItemRects.push({ x, y, w, h: DROP_SEP_H });
        // etched groove: a gray line with a white line just below, inset from the edges
        ctx.fillStyle = C_SHADOW;
        ctx.fillRect(x + 5, y + 3, w - 10, 1);
        ctx.fillStyle = C_LIGHT;
        ctx.fillRect(x + 5, y + 4, w - 10, 1);
        y += DROP_SEP_H;
        return;
      }
      const r = { x, y, w, h: DROP_ROW_H };
      ui.dropItemRects.push(r);
      const disabled = it.enabled === false;
      const sel = ui.hoverItem === i && !disabled;
      const ty2 = y + DROP_ROW_H / 2 + 1;
      if (sel) {
        ctx.fillStyle = C_TITLE; // navy interior, leaving the 2px bevel visible
        ctx.fillRect(x + 2, y, w - 4, DROP_ROW_H);
      }
      if (disabled) {
        if (it.checked) this.embossGlyph('✓', x + 6, ty2);
        this.embossText(it.label!, x + DROP_GUTTER, ty2, it.accel);
        if (it.shortcut) {
          ctx.textAlign = 'right';
          this.embossText(it.shortcut, x + w - DROP_PAD_R, ty2, undefined);
          ctx.textAlign = 'left';
        }
      } else {
        ctx.fillStyle = sel ? C_HILITE_TEXT : C_DARK;
        if (it.checked) ctx.fillText('✓', x + 6, ty2);
        this.menuText(it.label!, x + DROP_GUTTER, ty2, it.accel);
        if (it.shortcut) {
          ctx.textAlign = 'right';
          ctx.fillText(it.shortcut, x + w - DROP_PAD_R, ty2);
          ctx.textAlign = 'left';
        }
      }
      y += DROP_ROW_H;
    });
  }

  /** Win95 disabled text: a white highlight 1px down-right, then the gray face. */
  private embossText(label: string, x: number, y: number, accel: number | undefined): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_LIGHT;
    this.menuText(label, x + 1, y + 1, accel);
    ctx.fillStyle = C_GRAY_TEXT;
    this.menuText(label, x, y, accel);
  }

  /** Embossed single glyph (the checkmark) for disabled rows. */
  private embossGlyph(glyph: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = C_LIGHT;
    ctx.fillText(glyph, x + 1, y + 1);
    ctx.fillStyle = C_GRAY_TEXT;
    ctx.fillText(glyph, x, y);
  }

  // --- bitmap font (authentic in-game text) ---

  /** Advance width of `text` in the bitmap font at `scale` (logical px). */
  private bitmapTextWidth(text: string, scale: number): number {
    const m = this.font.metrics;
    let w = 0;
    for (const raw of text.toUpperCase()) {
      const g = m.glyphs[raw] ?? m.glyphs[' ']!;
      w += (g.w + m.gap) * scale;
    }
    return Math.max(0, w - m.gap * scale);
  }

  /** Draw `text` in the authentic bitmap font. `color` is a pre-tinted key. */
  private drawBitmapText(text: string, x: number, y: number, color: string, scale = 1): void {
    const m = this.font.metrics;
    const sheet = this.font.tinted.get(color) ?? this.font.tinted.get(FONT_WHITE)!;
    let cx = x;
    for (const raw of text.toUpperCase()) {
      const g = m.glyphs[raw] ?? m.glyphs[' ']!;
      if (raw !== ' ' && g.w > 0) {
        this.ctx.drawImage(sheet, g.x, g.y, g.w, g.h, Math.round(cx), Math.round(y), g.w * scale, g.h * scale);
      }
      cx += (g.w + m.gap) * scale;
    }
  }

  private drawDialog(ui: Ui): void {
    const ctx = this.ctx;
    const d = ui.dialog!;
    const isGoto = d.kind === 'goto';
    const isPw = d.kind === 'password';
    const w = isGoto ? 250 : isPw ? 320 : 240;
    const h = isGoto ? 150 : isPw ? 110 : 64 + (d.lines?.length ?? 1) * 15 + 16;
    const x = Math.round((LOGICAL_W - w) / 2);
    const y = Math.round((LOGICAL_H - h) / 2) - 10;

    // window: raised face + blue title bar
    ctx.fillStyle = C_FACE; ctx.fillRect(x, y, w, h);
    bevel(ctx, x, y, w, h, true, 2);
    ctx.fillStyle = C_TITLE; ctx.fillRect(x + 3, y + 3, w - 6, 16);
    drawBevelButton(ctx, x + 4, y + 4, 14, 14);
    ctx.fillStyle = C_DARK; ctx.fillRect(x + 7, y + 10, 8, 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px W95FA, Tahoma, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.title, x + w / 2, y + 11);

    ctx.textAlign = 'left';
    ctx.fillStyle = C_DARK;
    ctx.font = '12px W95FA, Tahoma, sans-serif';
    ui.dialogButtons = [];
    ui.dialogFieldRects = [];

    if (isGoto) {
      ctx.fillText('Enter a level number and password,', x + 14, y + 32);
      ctx.fillText('or just a password.', x + 14, y + 46);
      this.dialogField(ui, 'Level number:', d.levelField ?? '', d.focus === 'level', x + 14, y + 64, x + w - 90);
      this.dialogField(ui, 'Password:', d.passwordField ?? '', d.focus === 'password', x + 14, y + 86, x + w - 90);
      this.dialogButton(ui, 'OK', x + w / 2 - 78, y + h - 26, () => ui.confirmDialog());
      this.dialogButton(ui, 'Cancel', x + w / 2 + 6, y + h - 26, () => { ui.dialog = null; });
    } else if (isPw) {
      const label = `Please enter the password for level ${d.passwordLevel}:`;
      ctx.fillStyle = C_DARK;
      ctx.fillText(label, x + 14, y + 40);
      const fw = 60, fy = y + 32;
      const fx = x + 14 + ctx.measureText(label).width + 10;
      ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, fw, 16);
      bevel(ctx, fx, fy, fw, 16, false, 1);
      ctx.fillStyle = C_DARK;
      ctx.fillText((d.passwordField ?? '') + '|', fx + 4, fy + 8);
      ui.dialogFieldRects.push({ which: 'password', rect: { x: fx, y: fy, w: fw, h: 16 } });
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
    ctx.font = '12px W95FA, Tahoma, sans-serif';
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
    ctx.font = 'bold 11px W95FA, Tahoma, sans-serif';
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

/** Win95 "outset" border: 1px white top/left, 1px black bottom/right, 1px gray just inside BR. */
function bevelWin95(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = C_LIGHT; // white top + left
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = C_DARK; // black bottom + right
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  ctx.fillStyle = C_SHADOW; // gray inner bottom + right
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
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
