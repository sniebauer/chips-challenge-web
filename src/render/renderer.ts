// Canvas renderer: a 9x9 viewport centered on Chip plus the side info panel,
// drawn at native resolution and scaled up with nearest-neighbor for crisp pixels.

import { type GameState, MAP_W, MAP_H, tx, ty } from '../engine/state';
import { TILE } from '../engine/tiles';
import { type Atlas, srcOf, overlaySrcOf, TILE_PX } from './atlas';

export const VIEW = 9; // visible tiles per side
const VIEW_PX = VIEW * TILE_PX; // 288
const PANEL_PX = 128;
export const LOGICAL_W = VIEW_PX + PANEL_PX; // 416
export const LOGICAL_H = VIEW_PX; // 288

const KEY_CODES = [TILE.KEY_BLUE, TILE.KEY_RED, TILE.KEY_GREEN, TILE.KEY_YELLOW];
const BOOT_CODES = [TILE.BOOTS_WATER, TILE.BOOTS_FIRE, TILE.BOOTS_ICE, TILE.BOOTS_FORCE];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(private atlas: Atlas) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LOGICAL_W;
    this.canvas.height = LOGICAL_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  /** Scale the canvas to fit the container while staying pixel-aligned. */
  fit(container: HTMLElement): void {
    const scale = Math.max(1, Math.floor(Math.min(container.clientWidth / LOGICAL_W, container.clientHeight / LOGICAL_H)));
    this.canvas.style.width = `${LOGICAL_W * scale}px`;
    this.canvas.style.height = `${LOGICAL_H * scale}px`;
  }

  draw(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Camera: keep Chip centered, clamped to the map.
    const camX = clamp(tx(state.chipPos) - (VIEW >> 1), 0, MAP_W - VIEW);
    const camY = clamp(ty(state.chipPos) - (VIEW >> 1), 0, MAP_H - VIEW);

    for (let row = 0; row < VIEW; row++) {
      for (let col = 0; col < VIEW; col++) {
        const mx = camX + col;
        const my = camY + row;
        const dx = col * TILE_PX;
        const dy = row * TILE_PX;
        const i = my * MAP_W + mx;
        this.blit(state.terrain[i]!, dx, dy);
      }
    }

    // Mobs (blocks opaque, monsters masked).
    for (const m of state.mobs) {
      if (m.dead) continue;
      const mx = tx(m.pos);
      const my = ty(m.pos);
      if (mx < camX || mx >= camX + VIEW || my < camY || my >= camY + VIEW) continue;
      const dx = (mx - camX) * TILE_PX;
      const dy = (my - camY) * TILE_PX;
      if (m.kind === 'block') this.blit(TILE.BLOCK, dx, dy);
      else this.blitOverlay(m.id + m.dir, dx, dy);
    }

    // Chip.
    {
      const cx = (tx(state.chipPos) - camX) * TILE_PX;
      const cy = (ty(state.chipPos) - camY) * TILE_PX;
      const onTile = state.terrain[state.chipPos]! as number;
      const swimming = onTile === TILE.WATER;
      const code = swimming ? TILE.CHIP_SWIM_N + state.chipDir : TILE.CHIP_N + state.chipDir;
      if (swimming) this.blit(code, cx, cy);
      else this.blitOverlay(code, cx, cy);
    }

    this.drawPanel(state);
  }

  private blit(code: number, dx: number, dy: number): void {
    const [sx, sy] = srcOf(code);
    this.ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
  }

  private blitOverlay(code: number, dx: number, dy: number): void {
    // Terrain is already drawn underneath; overlay the masked sprite.
    const [sx, sy] = overlaySrcOf(code);
    this.ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, dx, dy, TILE_PX, TILE_PX);
  }

  private drawPanel(state: GameState): void {
    const ctx = this.ctx;
    const x0 = VIEW_PX;
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, 0, PANEL_PX, LOGICAL_H);

    ctx.fillStyle = '#d8d8d8';
    ctx.font = '11px Tahoma, sans-serif';
    ctx.textBaseline = 'top';

    const cx = x0 + 10;
    ctx.fillText(`LEVEL ${state.level.number}`, cx, 8);
    ctx.fillText(state.level.title.slice(0, 16), cx, 22);

    ctx.fillText('TIME', cx, 52);
    ctx.fillText(state.timeLeft < 0 ? '---' : String(state.timeLeft), cx, 66);

    ctx.fillText('CHIPS LEFT', cx, 92);
    ctx.fillText(String(state.chipsLeft), cx, 106);

    // Inventory: keys row, boots row.
    const iconY1 = 140;
    const iconY2 = 178;
    const sz = 28;
    for (let k = 0; k < 4; k++) {
      if (state.keys[k]! > 0) this.blitScaled(KEY_CODES[k]!, x0 + 6 + k * (sz + 2), iconY1, sz);
    }
    for (let b = 0; b < 4; b++) {
      if (state.boots[b]) this.blitScaled(BOOT_CODES[b]!, x0 + 6 + b * (sz + 2), iconY2, sz);
    }

    if (state.terrain[state.chipPos] === TILE.HINT && state.level.hint) {
      ctx.fillStyle = '#ffe070';
      wrapText(ctx, state.level.hint, x0 + 6, 214, PANEL_PX - 12, 13);
    }

    if (state.status === 'won') this.banner('LEVEL COMPLETE');
    else if (state.status === 'lost') this.banner(state.deathCause || 'OOPS!');
  }

  private blitScaled(code: number, dx: number, dy: number, size: number): void {
    const [sx, sy] = srcOf(code);
    this.ctx.drawImage(this.atlas.image, sx, sy, TILE_PX, TILE_PX, dx, dy, size, size);
  }

  private banner(text: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, VIEW_PX / 2 - 20, VIEW_PX, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, VIEW_PX / 2, VIEW_PX / 2 - 8);
    ctx.textAlign = 'left';
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  const words = text.split(/\s+/);
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}
