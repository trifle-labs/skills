/**
 * Base Strategy Class
 *
 * All strategies must extend this class and implement:
 * - computeVote(parsed, balance, state) -> { direction, team, amount, reason } | null
 *
 * Strategies can optionally override:
 * - shouldPlay(parsed, balance, state) -> boolean
 * - onGameStart(parsed, state) -> void
 * - onGameEnd(parsed, state, didWin) -> void
 * - onRoundEnd(parsed, state) -> void
 */

import {
  HEX_DIRECTIONS,
  OPPOSITE_DIRECTIONS,
  countExits,
} from '../game-state.mjs';

export class BaseStrategy {
  constructor(name, description, options = {}) {
    this.name = name;
    this.description = description;
    this.options = options;
  }

  /**
   * Compute the optimal vote for this round
   * @param {object} parsed - Parsed game state
   * @param {number} balance - Current ball balance
   * @param {object} state - Daemon state (currentTeam, etc.)
   * @returns {object|null} - { direction, team, amount, reason } or null to skip
   */
  computeVote(parsed, balance, state) {
    throw new Error('Strategy must implement computeVote()');
  }

  /**
   * Determine if we should participate this round
   * Default: play if we have enough balance
   */
  shouldPlay(parsed, balance, state) {
    if (!parsed?.active) return false;
    if (parsed.validDirections.length === 0) return false;
    if (balance < parsed.minBid) return false;
    return true;
  }

  /**
   * Called when a new game starts
   */
  onGameStart(parsed, state) {
    // Override in subclass if needed
  }

  /**
   * Called when a game ends
   */
  onGameEnd(parsed, state, didWin) {
    // Override in subclass if needed
  }

  /**
   * Called after each round
   */
  onRoundEnd(parsed, state) {
    // Override in subclass if needed
  }

  /**
   * Get option value with default fallback
   */
  getOption(key, defaultValue) {
    return this.options[key] ?? defaultValue;
  }

  /**
   * Score a direction based on safety (exits from new position)
   * Higher score = safer
   */
  scoreDirectionSafety(dir, parsed) {
    const offset = HEX_DIRECTIONS[dir];
    const newPos = {
      q: parsed.head.q + offset.q,
      r: parsed.head.r + offset.r,
    };
    return countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
  }

  /**
   * Find the safest valid direction
   */
  findSafestDirection(parsed) {
    let best = null;
    let bestSafety = -1;

    for (const dir of parsed.validDirections) {
      const safety = this.scoreDirectionSafety(dir, parsed);
      if (safety > bestSafety) {
        bestSafety = safety;
        best = dir;
      }
    }

    return best;
  }
}
