// Keyboard input with "typematic" behavior: a key press moves Chip exactly once,
// and only after the key has been held past a short delay does it auto-repeat (at
// the engine's 5/sec rate). This keeps a normal single press to one tile while a
// deliberate hold scrolls continuously — matching the original game's feel.

import { Dir, type Direction } from '../engine/tiles';

const KEY_DIR: Record<string, Direction> = {
  ArrowUp: Dir.N, ArrowLeft: Dir.W, ArrowDown: Dir.S, ArrowRight: Dir.E,
  KeyW: Dir.N, KeyA: Dir.W, KeyS: Dir.S, KeyD: Dir.E,
};

const REPEAT_DELAY_MS = 250; // hold this long before a held key auto-repeats

export class Keyboard {
  private held: Direction[] = [];
  private pressTime = new Map<Direction, number>();
  /** One-shot move for the initial press (cleared once Chip actually moves). */
  private pending: Direction | null = null;
  private pendingTtl = 0;
  /** Set when the player asks to restart the current level (R). */
  restartRequested = false;
  /** Millisecond clock; overridable in tests. */
  clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  attach(target: EventTarget = window): void {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') {
      this.restartRequested = true;
      return;
    }
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    e.preventDefault();
    if (e.repeat) return; // ignore OS auto-repeat; we manage repeat ourselves
    if (!this.held.includes(d)) this.held.push(d);
    this.pressTime.set(d, this.clock());
    this.pending = d;
    this.pendingTtl = 6; // long enough to reach Chip's next move window
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    this.held = this.held.filter((x) => x !== d);
    this.pressTime.delete(d);
  };

  /** Consume the buffered initial press once a move has happened. */
  clearPending(): void {
    this.pending = null;
    this.pendingTtl = 0;
  }

  /** The direction to apply this tick. */
  current(): Direction | null {
    // Auto-repeat: a key held past the delay drives continuous movement.
    if (this.held.length) {
      const d = this.held[this.held.length - 1]!;
      if (this.clock() - (this.pressTime.get(d) ?? 0) >= REPEAT_DELAY_MS) return d;
    }
    // Otherwise the one-shot initial press (offered until a move consumes it).
    if (this.pending !== null && this.pendingTtl > 0) {
      this.pendingTtl--;
      return this.pending;
    }
    this.pending = null;
    return null;
  }
}
