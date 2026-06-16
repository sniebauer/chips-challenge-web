// Touch input for mobile: an on-screen d-pad (arrow buttons) rendered below the
// game. Holding a button keeps that direction active (re-attempted each turn).
// Movement is via the d-pad — tap-to-walk is disabled on touch devices (main.ts).

import { Dir, type Direction } from '../engine/tiles';

export class Touch {
  private active: Direction | null = null;
  readonly element: HTMLElement;

  constructor() {
    this.element = this.buildDpad();
  }

  current(): Direction | null {
    return this.active;
  }

  private buildDpad(): HTMLElement {
    // Fills the area beneath the canvas and centers a 3x3 arrow cross.
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'flex:1 1 auto;width:100%;box-sizing:border-box;padding:16px;' +
      'display:grid;place-content:center;gap:10px;' +
      'grid-template-columns:repeat(3,76px);grid-template-rows:repeat(3,76px);' +
      'touch-action:none;user-select:none;';
    const cells: [number, number, Direction, string][] = [
      [2, 1, Dir.N, '▲'], [1, 2, Dir.W, '◀'], [3, 2, Dir.E, '▶'], [2, 3, Dir.S, '▼'],
    ];
    const FACE = '#c0c0c0', DOWN = '#9a9a9a';
    for (const [col, row, dir, glyph] of cells) {
      const b = document.createElement('button');
      b.textContent = glyph;
      b.style.cssText =
        `grid-column:${col};grid-row:${row};font-size:34px;border-radius:10px;` +
        'border:3px solid;border-color:#fff #808080 #808080 #fff;color:#000;' +
        `background:${FACE};display:flex;align-items:center;justify-content:center;` +
        'touch-action:none;cursor:pointer;line-height:1;';
      const set = (d: Direction | null) => (e: Event) => {
        e.preventDefault();
        this.active = d;
        b.style.background = d === null ? FACE : DOWN;
      };
      b.addEventListener('pointerdown', set(dir));
      b.addEventListener('pointerup', set(null));
      b.addEventListener('pointerleave', set(null));
      b.addEventListener('pointercancel', set(null));
      wrap.appendChild(b);
    }
    return wrap;
  }
}
