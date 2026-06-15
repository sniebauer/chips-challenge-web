// Touch input for mobile. Movement is tap-to-walk: tapping a tile sets a
// mouse-walk goal (handled by the canvas pointer handler in main.ts, same as a
// mouse click), so there is no on-screen d-pad. A swipe still gives a quick
// one-tile nudge in its direction.

import { Dir, type Direction } from '../engine/tiles';

export class Touch {
  private active: Direction | null = null;

  constructor() {
    this.attachSwipe();
  }

  current(): Direction | null {
    return this.active;
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
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // a tap -> handled as tap-to-walk
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.E : Dir.W) : (dy > 0 ? Dir.S : Dir.N);
      // A swipe gives a single-turn nudge.
      this.active = dir;
      setTimeout(() => { if (this.active === dir) this.active = null; }, 120);
    }, { passive: true });
  }
}
