// Keyboard input. Tracks currently-held arrow/WASD directions so a held key
// re-attempts each turn (matching MS), with the most recent press taking priority.

import { Dir, type Direction } from '../engine/tiles';

const KEY_DIR: Record<string, Direction> = {
  ArrowUp: Dir.N, ArrowLeft: Dir.W, ArrowDown: Dir.S, ArrowRight: Dir.E,
  KeyW: Dir.N, KeyA: Dir.W, KeyS: Dir.S, KeyD: Dir.E,
};

export class Keyboard {
  private held: Direction[] = [];
  /** One-shot buffered press so a quick tap between turns still moves once. */
  private pending: Direction | null = null;
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
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const d = KEY_DIR[e.code];
    if (d === undefined) return;
    this.held = this.held.filter((x) => x !== d);
  };

  /** The direction to apply this turn: a still-held key, else a one-shot buffered tap. */
  current(): Direction | null {
    if (this.held.length) return this.held[this.held.length - 1]!;
    if (this.pending !== null) {
      const p = this.pending;
      this.pending = null;
      return p;
    }
    return null;
  }
}
