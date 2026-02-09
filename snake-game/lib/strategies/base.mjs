/**
 * Base Strategy Class
 *
 * All strategies must extend this class and implement:
 * - computeVote(parsed, balance, state) -> { direction, team, amount, reason } | null
 *
 * Strategies can optionally override:
 * - shouldPlay(parsed, balance, state) -> boolean
 * - shouldCounterBid(parsed, balance, state, ourVote) -> vote object | null
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
   * Decide whether to counter-bid when our direction has been overridden.
   *
   * Called mid-round when the snake's currentDirection changed away from
   * what we voted for. Key mechanics:
   * - Last vote wins (not highest amount)
   * - Voting in extension window (<5s left): timer += 5s, minBid *= 2
   * - Payout is per vote count, not cumulative amount
   * - All-pay: everyone pays regardless of outcome
   *
   * @param {object} parsed - Current parsed game state
   * @param {number} balance - Current ball balance
   * @param {object} state - Daemon state with roundSpend tracking
   * @param {object} ourVote - The vote we submitted earlier this round
   * @returns {object|null} - Vote object to counter, or null to let it go
   */
  shouldCounterBid(parsed, balance, state, ourVote) {
    return null;
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
