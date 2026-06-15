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
  /** Logic turns per real second (MS = 5). */
  readonly turnsPerSecond: number;
  /** Advance the world by one logic turn. */
  stepTurn(state: GameState, input: MoveInput): void;
}
