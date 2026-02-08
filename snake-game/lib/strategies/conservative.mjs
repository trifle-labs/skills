/**
 * Conservative Strategy
 *
 * Minimizes risk with small bids and safe moves.
 * - Always uses minimum bid
 * - Prioritizes safety over optimal direction
 * - Skips rounds where we're behind
 */

import { BaseStrategy } from './base.mjs';
import {
  HEX_DIRECTIONS,
  OPPOSITE_DIRECTIONS,
  hexDistance,
  countExits,
} from '../game-state.mjs';

export class ConservativeStrategy extends BaseStrategy {
  constructor(options = {}) {
    super(
      'conservative',
      'Minimum bids, prioritizes safety. Risk-averse.',
      options
    );
  }

  shouldPlay(parsed, balance, state) {
    if (!super.shouldPlay(parsed, balance, state)) {
      return false;
    }

    const skipIfBehind = this.getOption('skipIfBehind', true);

    if (skipIfBehind && state.currentTeam) {
      const ourTeam = parsed.teams.find(t => t.id === state.currentTeam);
      const leadingTeam = [...parsed.teams].sort((a, b) => b.score - a.score)[0];

      // Skip if we're more than 1 fruit behind
      if (ourTeam && leadingTeam && leadingTeam.score - ourTeam.score > 1) {
        return false;
      }
    }

    return true;
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    // Find the safest team to back (leading or tied, with fruits nearby)
    const sortedTeams = [...parsed.teams]
      .filter(t => t.closestFruit)
      .sort((a, b) => {
        // Primary: highest score
        if (b.score !== a.score) return b.score - a.score;
        // Secondary: closest fruit (safer to reach)
        const aDist = a.closestFruit?.distance ?? 100;
        const bDist = b.closestFruit?.distance ?? 100;
        return aDist - bDist;
      });

    const targetTeam = sortedTeams[0];
    if (!targetTeam) {
      // No team has fruits, just pick safest direction
      const safestDir = this.findSafestDirection(parsed);
      if (!safestDir) return null;

      return {
        direction: safestDir,
        team: parsed.teams[0],
        amount: parsed.minBid,
        reason: 'safest_direction',
      };
    }

    // Find safest direction that also moves toward fruit
    const bestDir = this.findSafeDirectionToward(parsed, targetTeam.closestFruit?.fruit);

    if (!bestDir) return null;

    const maxBid = this.getOption('maxBidAmount', 1);

    return {
      direction: bestDir,
      team: targetTeam,
      amount: Math.min(parsed.minBid, maxBid),
      reason: 'safe_play',
    };
  }

  findSafestDirection(parsed) {
    let best = null;
    let bestSafety = -1;

    for (const dir of parsed.validDirections) {
      const offset = HEX_DIRECTIONS[dir];
      const newPos = {
        q: parsed.head.q + offset.q,
        r: parsed.head.r + offset.r,
      };

      const safety = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);

      if (safety > bestSafety) {
        bestSafety = safety;
        best = dir;
      }
    }

    return best;
  }

  findSafeDirectionToward(parsed, targetFruit) {
    let best = null;
    let bestScore = -Infinity;

    for (const dir of parsed.validDirections) {
      const offset = HEX_DIRECTIONS[dir];
      const newPos = {
        q: parsed.head.q + offset.q,
        r: parsed.head.r + offset.r,
      };

      // Safety is weighted heavily
      const safety = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
      let score = safety * 15;

      // Bonus for moving toward target
      if (targetFruit) {
        const dist = hexDistance(newPos, targetFruit);
        score += (10 - dist) * 3;
      }

      // Only consider safe moves (at least 2 exits)
      if (safety >= 2 && score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }

    // If no safe move found, fall back to safest available
    if (!best) {
      best = this.findSafestDirection(parsed);
    }

    return best;
  }
}
