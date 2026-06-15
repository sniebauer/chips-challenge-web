import { describe, it, expect } from 'vitest';
import { Keyboard } from '../src/input/keyboard';
import { Dir } from '../src/engine/tiles';

// Build a keyboard-event-like object (node has Event + EventTarget, not KeyboardEvent).
function key(type: string, code: string, repeat = false): Event {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code;
  e.repeat = repeat;
  return e;
}

/** A tick of the game loop: read the input, and if it would move Chip, clear the tap. */
function tickMove(kb: Keyboard): number | null {
  const dir = kb.current();
  if (dir !== null) kb.clearPending(); // a move happened this tick
  return dir;
}

describe('Keyboard input buffering', () => {
  it('a tap yields exactly one move, even between move windows', () => {
    const t = new EventTarget();
    const kb = new Keyboard();
    kb.attach(t);
    t.dispatchEvent(key('keydown', 'ArrowDown'));
    t.dispatchEvent(key('keyup', 'ArrowDown'));
    expect(tickMove(kb)).toBe(Dir.S); // the buffered tap fires once
    expect(tickMove(kb)).toBeNull(); // ...and not again
    expect(tickMove(kb)).toBeNull();
  });

  it('OS key-repeat during a hold leaves no stray move after release', () => {
    const t = new EventTarget();
    const kb = new Keyboard();
    kb.attach(t);
    t.dispatchEvent(key('keydown', 'ArrowRight', false)); // initial press
    t.dispatchEvent(key('keydown', 'ArrowRight', true)); // OS auto-repeat
    t.dispatchEvent(key('keydown', 'ArrowRight', true)); // OS auto-repeat
    // While held, movement comes from the held key (and clears the buffered tap).
    expect(tickMove(kb)).toBe(Dir.E);
    expect(tickMove(kb)).toBe(Dir.E);
    t.dispatchEvent(key('keyup', 'ArrowRight'));
    // After release: no held key and no stray buffered tap.
    expect(tickMove(kb)).toBeNull();
    expect(tickMove(kb)).toBeNull();
  });

  it('holding then releasing without an intervening move does not double-fire', () => {
    const t = new EventTarget();
    const kb = new Keyboard();
    kb.attach(t);
    t.dispatchEvent(key('keydown', 'ArrowUp', false));
    t.dispatchEvent(key('keyup', 'ArrowUp'));
    expect(tickMove(kb)).toBe(Dir.N); // one buffered move
    expect(tickMove(kb)).toBeNull(); // released, buffer consumed
  });
});
