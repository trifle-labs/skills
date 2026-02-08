/**
 * Aggressive Strategy
 *
 * Goes all-in on the leading team with higher bids.
 * - Always backs the team closest to winning
 * - Uses higher bid amounts to secure direction
 * - Willing to outbid competitors
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
      'High bids on leading teams. All-in mentality.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    // Find the team closest to winning (must have fruits to target)
    const teamsWithFruits = parsed.teams.filter(t => t.closestFruit !== null);
    if (teamsWithFruits.length === 0) {
      return { skip: true, reason: 'no_teams_with_fruits' };
    }

    const sortedTeams = [...teamsWithFruits].sort((a, b) => {
      // Primary: highest score
      if (b.score !== a.score) return b.score - a.score;
      // Secondary: closest fruit
      const aDist = a.closestFruit?.distance ?? 100;
      const bDist = b.closestFruit?.distance ?? 100;
      return aDist - bDist;
    });

    const targetTeam = sortedTeams[0];
    if (!targetTeam) return null;

    // Find best direction toward team's fruit
    const targetFruit = targetTeam.closestFruit?.fruit;
    const bestDir = this.findBestDirection(parsed, targetFruit);

    if (!bestDir) return null;

    // Calculate aggressive bid
    const bidAmount = this.calculateAggressiveBid(parsed, balance, bestDir);

    return {
      direction: bestDir,
      team: targetTeam,
      amount: bidAmount,
      reason: `backing_leader (score: ${targetTeam.score})`,
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

      // Distance to target (closer = better)
      if (targetFruit) {
        const dist = hexDistance(newPos, targetFruit);
        score += (10 - dist) * 10;
      }

      // Safety (but weighted less than in conservative strategies)
      const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
      score += exits * 3;

      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }

    return best;
  }

  calculateAggressiveBid(parsed, balance, direction) {
    const multiplier = this.getOption('bidMultiplier', 2);
    const alwaysOutbid = this.getOption('alwaysOutbid', true);

    let bid = parsed.minBid * multiplier;

    // Check existing votes
    const existingVote = parsed.votes[direction];
    if (existingVote && alwaysOutbid) {
      const currentAmount = existingVote.amount || existingVote.totalAmount || 0;
      bid = Math.max(bid, currentAmount + 1);
    }

    // Don't bet more than half our balance
    bid = Math.min(bid, Math.floor(balance / 2));

    // But at least the minimum
    bid = Math.max(bid, parsed.minBid);

    return bid;
  }
}
