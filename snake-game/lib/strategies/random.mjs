/**
 * Random Strategy
 *
 * Makes random valid moves. Useful for testing or when you just want chaos.
 */

import { BaseStrategy } from './base.mjs';

export class RandomStrategy extends BaseStrategy {
  constructor(options = {}) {
    super(
      'random',
      'Random valid moves. For testing or chaos.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    // Pick random direction
    const dirs = parsed.validDirections;
    const direction = dirs[Math.floor(Math.random() * dirs.length)];

    // Pick random team
    const teams = parsed.teams.filter(t => t.closestFruit);
    const team = teams.length > 0
      ? teams[Math.floor(Math.random() * teams.length)]
      : parsed.teams[0];

    return {
      direction,
      team,
      amount: parsed.minBid,
      reason: 'random',
    };
  }
}
