// Touch input: swipe-to-move plus a translucent on-screen d-pad for mobile.
// Holding a d-pad button keeps that direction active (re-attempted each turn).

import { Dir, type Direction } from '../engine/tiles';

export class Touch {
  private active: Direction | null = null;
  readonly element: HTMLElement;

  constructor() {
    this.element = this.buildDpad();
    this.attachSwipe();
  }

  current(): Direction | null {
    return this.active;
  }

  private buildDpad(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:grid;' +
      'grid-template-columns:repeat(3,56px);grid-template-rows:repeat(3,56px);gap:4px;' +
      'opacity:0.35;touch-action:none;z-index:10;user-select:none;';
    const cells: [number, number, Direction | null, string][] = [
      [1, 0, Dir.N, '▲'], [0, 1, Dir.W, '◀'], [2, 1, Dir.E, '▶'], [1, 2, Dir.S, '▼'],
    ];
    for (const [c, r, dir, glyph] of cells) {
      const b = document.createElement('button');
      b.textContent = glyph;
      b.style.cssText =
        `grid-column:${c + 1};grid-row:${r + 1};font-size:24px;border-radius:8px;` +
        'border:1px solid #888;background:#222;color:#eee;touch-action:none;';
      const set = (d: Direction | null) => (e: Event) => {
        e.preventDefault();
        this.active = d;
      };
      b.addEventListener('pointerdown', set(dir));
      b.addEventListener('pointerup', set(null));
      b.addEventListener('pointerleave', set(null));
      b.addEventListener('pointercancel', set(null));
      wrap.appendChild(b);
    }
    // Show only on touch-capable, small screens.
    if (!matchMedia('(pointer: coarse)').matches) wrap.style.display = 'none';
    return wrap;
  }

  private attachSwipe(): void {
    let sx = 0, sy = 0, tracking = false;
    window.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX; sy = t.clientY; tracking = true;
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.E : Dir.W) : (dy > 0 ? Dir.S : Dir.N);
      // A swipe gives a single-turn nudge.
      this.active = dir;
      setTimeout(() => { if (this.active === dir) this.active = null; }, 120);
    }, { passive: true });
  }
}
