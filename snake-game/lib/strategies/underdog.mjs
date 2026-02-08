/**
 * Underdog Strategy
 *
 * Backs teams with small pools for bigger payout potential.
 * - Focuses on payout multiplier over win probability
 * - Prefers teams that are behind but have a path to victory
 * - Good for building ball balance over time
 */

import { BaseStrategy } from './base.mjs';
import {
  HEX_DIRECTIONS,
  OPPOSITE_DIRECTIONS,
  hexDistance,
  countExits,
} from '../game-state.mjs';

export class UnderdogStrategy extends BaseStrategy {
  constructor(options = {}) {
    super(
      'underdog',
      'Backs teams with small pools for bigger payouts.',
      options
    );
  }

  computeVote(parsed, balance, state) {
    if (!this.shouldPlay(parsed, balance, state)) {
      return null;
    }

    const maxPoolSize = this.getOption('maxPoolSize', 10);
    const minPayoutMultiplier = this.getOption('minPayoutMultiplier', 2.0);

    // Find underdog teams with good payout potential
    const candidates = parsed.teams
      .filter(team => {
        // Must have fruits to score
        if (!team.closestFruit) return false;
        // Must have small pool
        if (team.pool > maxPoolSize) return false;
        // Must have path to victory (not too far behind)
        const fruitsNeeded = parsed.fruitsToWin - team.score;
        if (fruitsNeeded > parsed.fruitsToWin) return false;
        return true;
      })
      .map(team => {
        const payoutMultiplier = parsed.prizePool / (team.pool + 1);
        return { team, payoutMultiplier };
      })
      .filter(t => t.payoutMultiplier >= minPayoutMultiplier)
      .sort((a, b) => b.payoutMultiplier - a.payoutMultiplier);

    if (candidates.length === 0) {
      // Fall back to team with smallest pool that can still win
      const fallback = [...parsed.teams]
        .filter(t => t.closestFruit)
        .sort((a, b) => a.pool - b.pool)[0];

      if (!fallback) return null;

      const bestDir = this.findBestDirection(parsed, fallback.closestFruit?.fruit);
      if (!bestDir) return null;

      return {
        direction: bestDir,
        team: fallback,
        amount: parsed.minBid,
        reason: 'fallback_smallest_pool',
      };
    }

    const targetTeam = candidates[0].team;
    const targetFruit = targetTeam.closestFruit?.fruit;
    const bestDir = this.findBestDirection(parsed, targetFruit);

    if (!bestDir) return null;

    return {
      direction: bestDir,
      team: targetTeam,
      amount: parsed.minBid,
      reason: `underdog (${candidates[0].payoutMultiplier.toFixed(1)}x payout)`,
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

      // Distance to target
      if (targetFruit) {
        const dist = hexDistance(newPos, targetFruit);
        score += (10 - dist) * 5;
      }

      // Safety
      const exits = countExits(newPos, parsed.raw, OPPOSITE_DIRECTIONS[dir]);
      score += exits * 8;

      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }

    return best;
  }
}
