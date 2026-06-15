// Keyboard input. Tracks currently-held arrow/WASD directions so a held key
// re-attempts each turn (matching MS), with the most recent press taking priority.

import { Dir, type Direction } from '../engine/tiles';

const KEY_DIR: Record<string, Direction> = {
  ArrowUp: Dir.N, ArrowLeft: Dir.W, ArrowDown: Dir.S, ArrowRight: Dir.E,
  KeyW: Dir.N, KeyA: Dir.W, KeyS: Dir.S, KeyD: Dir.E,
};

export class Keyboard {
  private held: Direction[] = [];
  /** Buffered tap, offered for a few ticks so it lands on Chip's next move window. */
  private pending: Direction | null = null;
  private pendingTtl = 0;
  /** Set when the player asks to restart the current level (R). */
  restartRequested = false;

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
    if (!this.held.includes(d)) this.held.push(d);
    this.pending = d;
    this.pendingTtl = 4; // one 1/5s move window at 20 ticks/sec
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    this.held = this.held.filter((x) => x !== d);
  };

  /** The direction to apply this turn: a still-held key, else a one-shot buffered tap. */
  current(): Direction | null {
    if (this.held.length) return this.held[this.held.length - 1]!;
    if (this.pending !== null && this.pendingTtl > 0) {
      this.pendingTtl--;
      return this.pending;
    }
    this.pending = null;
    return null;
  }
}
