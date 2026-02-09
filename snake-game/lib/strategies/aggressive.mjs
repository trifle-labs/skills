/**
 * Aggressive Strategy
 *
 * Backs the leading team, always tries to get the last word.
 * - Counters bids up to a configurable extension depth
 * - Uses minBid (amount doesn't affect payout share)
 * - Willing to enter bidding wars within budget
 */

import { BaseStrategy } from './base.mjs';
import {
  HEX_DIRECTIONS,
  OPPOSITE_DIRECTIONS,
  hexDistance,
  countExits,
} from '../game-state.mjs';

export class AggressiveStrategy extends BaseStrategy {
  constructor(options = {}) {
    super(
      'aggressive',
      'Backs leaders, counter-bids aggressively. Gets the last word.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    const teamsWithFruits = parsed.teams.filter(t => t.closestFruit !== null);
    if (teamsWithFruits.length === 0) {
      return { skip: true, reason: 'no_teams_with_fruits' };
    }

    const sortedTeams = [...teamsWithFruits].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDist = a.closestFruit?.distance ?? 100;
      const bDist = b.closestFruit?.distance ?? 100;
      return aDist - bDist;
    });

    const targetTeam = sortedTeams[0];
    if (!targetTeam) return null;

    const targetFruit = targetTeam.closestFruit?.fruit;
    const bestDir = this.findBestDirection(parsed, targetFruit);
    if (!bestDir) return null;

    return {
      direction: bestDir,
      team: targetTeam,
      amount: parsed.minBid,
      reason: `backing_leader (score:${targetTeam.score}, cost:${parsed.minBid})`,
    };
  }

  /**
   * Aggressive counter-bidding: will fight for direction up to N extensions.
   * Stops when cost gets too high relative to balance.
   */
  shouldCounterBid(parsed, balance, state, ourVote) {
    const maxExtensions = this.getOption('maxCounterExtensions', 2);

    if (parsed.extensions > maxExtensions) {
      return null;
    }

    // Don't blow more than 30% of balance on one round
    if (parsed.minBid > balance * 0.3) {
      return null;
    }

    if ((state.roundBudgetRemaining || 0) < parsed.minBid) {
      return null;
    }

    return {
      direction: ourVote.direction,
      team: ourVote.team,
      amount: parsed.minBid,
      reason: `counter-agg (ext:${parsed.extensions}, cost:${parsed.minBid})`,
    };
  }

  findBestDirection(parsed, targetFruit) {
    let best = null;
    let bestScore = -Infinity;

    for (const dir of parsed.validDirections) {
      const offset = HEX_DIRECTIONS[dir];
      const newPos = {
        q: parsed.head.q + offset.q,
        r: parsed.head.r + offset.r,
      };

      let score = 0;

      if (targetFruit) {
        const dist = hexDistance(newPos, targetFruit);
        if (dist === 0) {
          score += 1000;
        } else {
          score += (10 - dist) * 10;
        }
      }

      const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
      score += exits * 3;

      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }

    return best;
  }
}
