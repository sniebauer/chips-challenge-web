import { describe, it, expect } from 'vitest';
import { Keyboard } from '../src/input/keyboard';
import { Dir } from '../src/engine/tiles';

function key(type: string, code: string, repeat = false): Event {
  const e = new Event(type) as Event & { code: string; repeat: boolean };
  e.code = code;
  e.repeat = repeat;
  return e;
}

/** Build a keyboard with a controllable clock. */
function makeKb() {
  const t = new EventTarget();
  const kb = new Keyboard();
  const time = { now: 0 };
  kb.clock = () => time.now;
  kb.attach(t);
  return { t, kb, time };
}

/** One game-loop tick: read input; if it would move Chip, clear the one-shot tap. */
function tick(kb: Keyboard): number | null {
  const dir = kb.current();
  if (dir !== null) kb.clearPending();
  return dir;
}

describe('Keyboard input (typematic)', () => {
  it('a single press moves exactly once, regardless of how long it is held below the repeat delay', () => {
    const { t, kb, time } = makeKb();
    t.dispatchEvent(key('keydown', 'ArrowDown'));
    expect(tick(kb)).toBe(Dir.S); // the move
    time.now = 60; expect(tick(kb)).toBeNull();
    time.now = 150; expect(tick(kb)).toBeNull(); // still within repeat delay
    time.now = 240; expect(tick(kb)).toBeNull();
    t.dispatchEvent(key('keyup', 'ArrowDown'));
    time.now = 300; expect(tick(kb)).toBeNull();
  });

  it('a held key auto-repeats only after the repeat delay', () => {
    const { t, kb, time } = makeKb();
    t.dispatchEvent(key('keydown', 'ArrowRight')); // pressed at now=0
    expect(tick(kb)).toBe(Dir.E); // initial move
    time.now = 100; expect(tick(kb)).toBeNull(); // within delay: no repeat
    time.now = 250; expect(tick(kb)).toBe(Dir.E); // delay elapsed: repeat
    time.now = 300; expect(tick(kb)).toBe(Dir.E); // keeps repeating while held
  });

  it('OS key-repeat events never arm an extra move', () => {
    const { t, kb } = makeKb();
    t.dispatchEvent(key('keydown', 'ArrowUp', false));
    t.dispatchEvent(key('keydown', 'ArrowUp', true)); // OS auto-repeat
    t.dispatchEvent(key('keydown', 'ArrowUp', true));
    expect(tick(kb)).toBe(Dir.N); // exactly one buffered move
    t.dispatchEvent(key('keyup', 'ArrowUp'));
    expect(tick(kb)).toBeNull(); // released: nothing stray
  });
});
