// Ruleset seam. logic-ms.ts implements the MS (Windows) ruleset; a Lynx ruleset
// can later implement the same interface without touching the engine driver.

import type { GameState } from './state';
import type { Direction } from './tiles';

export interface MoveInput {
  /** Direction the player wants Chip to move this turn, or null for none. */
  dir: Direction | null;
}

export interface Ruleset {
  readonly name: string;
  /** Chip's nominal moves per second (MS = 5). */
  readonly turnsPerSecond: number;
  /** Master-clock ticks per second (MS = 20). */
  readonly ticksPerSecond: number;
  /** Advance the world by one 1/20s tick. */
  advanceTick(state: GameState, input: MoveInput): void;
  /** Advance one 1/5s turn (= 4 ticks); convenience for turn-based callers. */
  stepTurn(state: GameState, input: MoveInput): void;
}
